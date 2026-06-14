import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ConnectionsRepository } from '@/lib/db/ConnectionsRepository';
import { decrypt } from '@/lib/encryption';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

const CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET || '';

type DraftToSend = {
  threadId: string;
  messageId: string;
  replyToMessageId?: string;
  references?: string;
  from: string;
  subject: string;
  draftResponse: string;
};

function requireSession() {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return null;
  try { return JSON.parse(session.value); } catch { return null; }
}

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Token error: ${data.error} ${data.error_description ?? ''}`);
  return data.access_token;
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function POST(req: Request) {
  const user = requireSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.json({ error: 'GOOGLE_GMAIL_CLIENT_ID / GOOGLE_GMAIL_CLIENT_SECRET not configured.' }, { status: 500 });
  }

  const { databaseId, drafts } = await req.json();
  if (!databaseId || databaseId !== user.userSpreadsheetId) return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
  if (!Array.isArray(drafts) || drafts.length === 0) {
    return NextResponse.json({ error: 'drafts array is required.' }, { status: 400 });
  }

  let refreshToken = '';

  try {
    const conn = await ConnectionsRepository.get(databaseId);
    const enc = conn?.gmail_refresh_token ?? '';
    if (enc) {
      try {
        refreshToken = decrypt(enc);
      } catch {
        refreshToken = enc;
      }
    }
  } catch {
    return NextResponse.json({ error: 'Could not load Gmail connection details.' }, { status: 500 });
  }

  if (!refreshToken) {
    return NextResponse.json({ error: 'Gmail refresh token is not configured in Connections.' }, { status: 400 });
  }

  const accessToken = await getAccessToken(refreshToken);

  const results: Array<{ messageId: string; success: boolean; error?: string }> = [];

  for (const rawDraft of drafts as DraftToSend[]) {
    try {
      const to = String(rawDraft.from || '').trim();
      const body = String(rawDraft.draftResponse || '').trim();
      if (!to || !body) {
        results.push({ messageId: rawDraft.messageId, success: false, error: 'Missing recipient or body.' });
        continue;
      }

      const subjectBase = String(rawDraft.subject || '').trim() || '(No subject)';
      const subject = /^re:/i.test(subjectBase) ? subjectBase : `Re: ${subjectBase}`;

      const headers = [
        `To: ${to}`,
        `Subject: ${subject}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
      ];
      if (rawDraft.replyToMessageId) headers.push(`In-Reply-To: ${rawDraft.replyToMessageId}`);
      if (rawDraft.references) headers.push(`References: ${rawDraft.references}`);

      const mime = `${headers.join('\r\n')}\r\n\r\n${body}\r\n`;
      const encoded = toBase64Url(mime);

      const sendRes = await fetch(`${GMAIL_API}/messages/send`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: encoded,
          threadId: rawDraft.threadId,
        }),
      });

      const sendData = await sendRes.json();
      if (!sendRes.ok || sendData.error) {
        results.push({
          messageId: rawDraft.messageId,
          success: false,
          error: sendData?.error?.message || 'Failed to send via Gmail API.',
        });
      } else {
        results.push({ messageId: rawDraft.messageId, success: true });
      }
    } catch (e: any) {
      results.push({ messageId: rawDraft.messageId, success: false, error: e.message || 'Unknown error' });
    }
  }

  return NextResponse.json({ results });
}
