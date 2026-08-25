import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailApiError extends Error {
  status: number;
  reason: string | null;

  constructor(message: string, status: number, reason?: string | null) {
    super(message);
    this.name = 'GmailApiError';
    this.status = status;
    this.reason = reason ?? null;
  }
}

export interface GmailAttachmentMetadata {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
}

export interface NormalizedGmailMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  messageIdHeader: string;
  referencesHeader: string;
  unsubscribeUrl: string | null;
  bodyPlain: string;
  labels: string[];
  attachments: GmailAttachmentMetadata[];
  messageAt: string;
}

export interface NormalizedGmailThread {
  gmailThreadId: string;
  historyId: string | null;
  snippet: string;
  messages: NormalizedGmailMessage[];
}

function decodeBase64Url(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64').toString('utf8');
}

function header(headers: any[] | undefined, name: string): string {
  return headers?.find(item => String(item?.name || '').toLowerCase() === name.toLowerCase())?.value || '';
}

export function extractHttpsUnsubscribeUrl(value: string): string | null {
  for (const match of value.matchAll(/<([^>]+)>/g)) {
    try {
      const url = new URL(match[1].trim());
      if (url.protocol === 'https:') return url.toString().slice(0, 2000);
    } catch { /* ignore malformed or unsupported unsubscribe targets */ }
  }
  return null;
}

function splitAddresses(value: string): string[] {
  return value.split(',').map(item => item.trim()).filter(Boolean).slice(0, 50);
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractMimeContent(payload: any): { plain: string; html: string; attachments: GmailAttachmentMetadata[] } {
  const attachments: GmailAttachmentMetadata[] = [];
  const plainParts: string[] = [];
  const htmlParts: string[] = [];

  function visit(part: any): void {
    if (!part) return;
    const mimeType = String(part.mimeType || '').toLowerCase();
    const filename = String(part.filename || '').trim();
    if (filename || part.body?.attachmentId) {
      attachments.push({
        filename: filename || 'attachment',
        mimeType: mimeType || 'application/octet-stream',
        size: Number(part.body?.size || 0),
        attachmentId: part.body?.attachmentId || null,
      });
    } else if (part.body?.data) {
      try {
        const decoded = decodeBase64Url(part.body.data);
        if (mimeType === 'text/plain') plainParts.push(decoded);
        else if (mimeType === 'text/html') htmlParts.push(decoded);
      } catch { /* ignore malformed MIME part */ }
    }
    for (const child of Array.isArray(part.parts) ? part.parts : []) visit(child);
  }

  visit(payload);
  return { plain: plainParts.join('\n\n'), html: htmlParts.join('\n\n'), attachments };
}

function cleanBody(value: string): string {
  return value.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, 100000);
}

function normalizeMessage(message: any): NormalizedGmailMessage {
  const headers = message?.payload?.headers;
  const content = extractMimeContent(message?.payload);
  const bodyPlain = cleanBody(content.plain || htmlToPlainText(content.html) || message?.snippet || '');
  return {
    gmailMessageId: String(message.id || ''),
    gmailThreadId: String(message.threadId || ''),
    from: header(headers, 'From'),
    to: splitAddresses(header(headers, 'To')),
    cc: splitAddresses(header(headers, 'Cc')),
    subject: header(headers, 'Subject') || '(No subject)',
    messageIdHeader: header(headers, 'Message-ID'),
    referencesHeader: header(headers, 'References') || header(headers, 'In-Reply-To'),
    unsubscribeUrl: extractHttpsUnsubscribeUrl(header(headers, 'List-Unsubscribe')),
    bodyPlain,
    labels: Array.isArray(message.labelIds) ? message.labelIds : [],
    attachments: content.attachments,
    messageAt: new Date(Number(message.internalDate || Date.now())).toISOString().slice(0, 19).replace('T', ' '),
  };
}

export function normalizeGmailThread(thread: any): NormalizedGmailThread {
  return {
    gmailThreadId: String(thread?.id || ''),
    historyId: thread?.historyId ? String(thread.historyId) : null,
    snippet: String(thread?.snippet || '').slice(0, 1000),
    messages: (Array.isArray(thread?.messages) ? thread.messages : [])
      .map(normalizeMessage)
      .filter((message: NormalizedGmailMessage) => message.gmailMessageId && message.gmailThreadId)
      .sort((left: NormalizedGmailMessage, right: NormalizedGmailMessage) => left.messageAt.localeCompare(right.messageAt)),
  };
}

async function gmailFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${GMAIL_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data = await response.json();
  if (!response.ok || data?.error) {
    const message = data?.error?.message || `Gmail request failed (${response.status})`;
    const reason = data?.error?.errors?.[0]?.reason || null;
    throw new GmailApiError(message, response.status, reason);
  }
  return data as T;
}

export function isGmailInsufficientScopeError(error: unknown): boolean {
  const message = String((error as any)?.message || '').toLowerCase();
  const reason = String((error as any)?.reason || '').toLowerCase();
  const status = Number((error as any)?.status || 0);
  return reason === 'insufficientscope'
    || message.includes('insufficient authentication scopes')
    || (status === 403 && message.includes('insufficient'));
}

export async function getGmailAccess(businessId: string): Promise<{ accessToken: string; mailboxEmail: string }> {
  const connection = await ConnectionsRepository.get(businessId);
  if (!connection?.gmail_refresh_token) throw new Error('Gmail is not connected');

  let refreshToken = connection.gmail_refresh_token;
  let clientSecret = connection.gmail_client_secret || process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';
  try { refreshToken = decrypt(refreshToken); } catch { /* legacy plaintext */ }
  try { clientSecret = decrypt(clientSecret); } catch { /* legacy plaintext */ }
  const clientId = connection.gmail_client_id || process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '';
  if (!clientId || !clientSecret) throw new Error('Gmail OAuth client credentials are not configured');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error_description || data.error || 'Gmail token refresh failed');
  const grantedScopes = String(data.scope || '').trim();
  if (grantedScopes && !grantedScopes.split(/\s+/).includes('https://www.googleapis.com/auth/gmail.modify')) {
    throw new Error('Gmail connection is missing mailbox modify permission. Reconnect Gmail and approve all requested permissions.');
  }
  const profile = await gmailFetch<{ emailAddress: string }>(data.access_token, '/profile');
  return { accessToken: data.access_token, mailboxEmail: String(profile.emailAddress || '').toLowerCase() };
}

export async function fetchRecentGmailThreads(accessToken: string, days: number, maximum?: number): Promise<NormalizedGmailThread[]> {
  const threadIds = new Set<string>();
  let pageToken = '';
  const query = `in:inbox newer_than:${Math.max(1, Math.min(90, days))}d -in:spam -in:trash`;
  do {
    const params = new URLSearchParams({ q: query, maxResults: '100' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await gmailFetch<{ messages?: Array<{ threadId: string }>; nextPageToken?: string }>(accessToken, `/messages?${params}`);
    for (const message of page.messages || []) {
      if (message.threadId) threadIds.add(message.threadId);
      if (maximum && threadIds.size >= maximum) break;
    }
    pageToken = !maximum || threadIds.size < maximum ? page.nextPageToken || '' : '';
  } while (pageToken);

  const ids = maximum ? [...threadIds].slice(0, maximum) : [...threadIds];
  const threads: NormalizedGmailThread[] = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = await Promise.all(ids.slice(index, index + 10).map(id =>
      gmailFetch<any>(accessToken, `/threads/${encodeURIComponent(id)}?format=full`).then(normalizeGmailThread),
    ));
    threads.push(...batch);
  }
  return threads;
}

export async function modifyGmailMessageLabels(accessToken: string, messageId: string, input: {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<void> {
  await gmailFetch(accessToken, `/messages/${encodeURIComponent(messageId)}/modify`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

export async function modifyGmailThreadLabels(accessToken: string, threadId: string, input: {
  addLabelIds?: string[];
  removeLabelIds?: string[];
}): Promise<void> {
  await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: 'POST', body: JSON.stringify(input),
  });
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildReplyRaw(input: {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
  references?: string | null;
  messageIdHeader?: string | null;
}): string {
  const headers = [
    `To: ${input.to.replace(/[\r\n]/g, '')}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.map(value => value.replace(/[\r\n]/g, '')).join(', ')}`] : []),
    `Subject: ${input.subject.replace(/[\r\n]/g, '')}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if (input.messageIdHeader) headers.push(`Message-ID: ${input.messageIdHeader.replace(/[\r\n]/g, '')}`);
  if (input.replyToMessageId) headers.push(`In-Reply-To: ${input.replyToMessageId.replace(/[\r\n]/g, '')}`);
  if (input.references) headers.push(`References: ${input.references.replace(/[\r\n]/g, '')}`);
  return toBase64Url(`${headers.join('\r\n')}\r\n\r\n${input.body}\r\n`);
}

export async function saveGmailReplyDraft(accessToken: string, input: {
  gmailDraftId?: string | null;
  gmailThreadId?: string | null;
  to: string;
  cc?: string[];
  subject: string;
  body: string;
  replyToMessageId?: string | null;
  references?: string | null;
  messageIdHeader?: string | null;
}): Promise<{ draftId: string; messageId: string }> {
  const path = input.gmailDraftId ? `/drafts/${encodeURIComponent(input.gmailDraftId)}` : '/drafts';
  const result = await gmailFetch<any>(accessToken, path, {
    method: input.gmailDraftId ? 'PUT' : 'POST',
    body: JSON.stringify({
      id: input.gmailDraftId || undefined,
      message: {
        ...(input.gmailThreadId ? { threadId: input.gmailThreadId } : {}),
        raw: buildReplyRaw(input),
      },
    }),
  });
  return { draftId: String(result.id), messageId: String(result.message?.id || '') };
}

export async function sendGmailReply(accessToken: string, input: {
  gmailThreadId: string;
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string | null;
  references?: string | null;
}): Promise<{ messageId: string }> {
  const result = await gmailFetch<any>(accessToken, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ threadId: input.gmailThreadId, raw: buildReplyRaw(input) }),
  });
  return { messageId: String(result.id || '') };
}

export async function sendExistingGmailDraft(accessToken: string, draftId: string): Promise<{ messageId: string; threadId: string }> {
  const result = await gmailFetch<any>(accessToken, '/drafts/send', {
    method: 'POST',
    body: JSON.stringify({ id: draftId }),
  });
  return { messageId: String(result.id || ''), threadId: String(result.threadId || '') };
}

export function isDefinitiveGmailSendFailure(error: unknown): boolean {
  return error instanceof GmailApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429;
}