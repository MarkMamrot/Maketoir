'use client';

import { FormEvent, KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, MessageCircle, RefreshCw, Sparkles, Trash2, UserRound, X } from 'lucide-react';

import { ProspectLeadForm } from './ProspectLeadForm';
import styles from './ProspectSalesAssistant.module.css';

type MessageStatus = 'sent' | 'sending' | 'failed';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
}

interface ChatResponse {
  answer?: string;
  conversationId?: string;
  messageCount?: number;
  offerContact?: boolean;
  fit?: 'strong_fit' | 'possible_fit' | 'needs_discovery' | 'not_fit';
}

const STARTERS = [
  'We run several retail locations. How would Solvantis fit?',
  'Can POS, stock and Xero work together?',
  'We sell wholesale and online. What could we unify?',
  'Can you work with our 3PL or another provider?',
];

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function fitLabel(fit?: ChatResponse['fit']): string | null {
  if (fit === 'strong_fit') return 'Looks like a strong fit';
  if (fit === 'possible_fit') return 'Potential fit';
  if (fit === 'needs_discovery') return 'A little more discovery needed';
  if (fit === 'not_fit') return 'May not be the right fit';
  return null;
}

function normalizedMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const message = item as Record<string, unknown>;
    if ((message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string') return [];
    return [{
      id: typeof message.id === 'string' ? message.id : `restored-${index}`,
      role: message.role,
      content: message.content,
      status: 'sent' as const,
    }];
  });
}

function currentAttribution(sourcePath: string) {
  const params = new URLSearchParams(window.location.search);
  return {
    sourcePath,
    referrer: document.referrer || null,
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmTerm: params.get('utm_term'),
    utmContent: params.get('utm_content'),
  };
}

export function ProspectSalesAssistant({
  sourcePath,
  showHeroPrompt = false,
}: {
  sourcePath: string;
  showHeroPrompt?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [launcherVisible, setLauncherVisible] = useState(false);
  const [draft, setDraft] = useState('');
  const [heroDraft, setHeroDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [contactSuggested, setContactSuggested] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactDismissed, setContactDismissed] = useState(false);
  const [fit, setFit] = useState<ChatResponse['fit']>();
  const [deleteError, setDeleteError] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const recordEvent = (eventType: string, data?: unknown) => {
    const idempotencyKey = crypto.randomUUID();
    void fetch('/api/public/sales-assistant/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ idempotencyKey, eventType, conversationId, data, sourcePath }),
      keepalive: true,
    }).catch(() => undefined);
  };

  useEffect(() => {
    const updateVisibility = () => setLauncherVisible(window.scrollY > 320);
    updateVisibility();
    window.addEventListener('scroll', updateVisibility, { passive: true });
    return () => window.removeEventListener('scroll', updateVisibility);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/public/sales-assistant/conversation', { method: 'GET', cache: 'no-store' })
      .then(async response => {
        if (response.status === 404 || response.status === 204) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error('History unavailable');
        return data;
      })
      .then(data => {
        if (cancelled || !data) return;
        setConversationId(typeof data.conversationId === 'string' ? data.conversationId
          : typeof data.conversation?.id === 'string' ? data.conversation.id : null);
        setMessages(normalizedMessages(data.messages || data.conversation?.messages));
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => inputRef.current?.focus(), 0);

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, contactOpen, contactSuggested]);

  const openDialog = (opener?: HTMLElement | null) => {
    returnFocusRef.current = opener || document.activeElement as HTMLElement | null;
    setOpen(true);
    recordEvent('assistant_opened', { source: showHeroPrompt ? 'hero_or_launcher' : 'launcher' });
  };

  const closeDialog = () => {
    setOpen(false);
    recordEvent('assistant_closed');
    window.setTimeout(() => returnFocusRef.current?.focus(), 0);
  };

  const sendMessage = async (message: string, existingId?: string) => {
    const content = message.trim();
    if (!content || sending) return;
    const messageId = existingId || crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();
    const history = messages.filter(item => item.status === 'sent').slice(-8).map(item => ({ role: item.role, content: item.content }));

    setMessages(previous => existingId
      ? previous.map(item => item.id === existingId ? { ...item, status: 'sending' } : item)
      : [...previous, { id: messageId, role: 'user', content, status: 'sending' }]);
    setDraft('');
    setHeroDraft('');
    setSending(true);
    setDeleteError('');

    try {
      const response = await fetch('/api/public/sales-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ message: content, conversationId, idempotencyKey, attribution: currentAttribution(sourcePath) }),
      });
      const data = await response.json().catch(() => ({})) as ChatResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || 'The assistant could not answer just now.');
      const nextConversationId = typeof data.conversationId === 'string' ? data.conversationId : conversationId;
      const nextFit = fitLabel(data.fit);
      setConversationId(nextConversationId);
      setFit(data.fit);
      setMessages(previous => [
        ...previous.map(item => item.id === messageId ? { ...item, status: 'sent' as const } : item),
        { id: crypto.randomUUID(), role: 'assistant', content: String(data.answer || 'Let me connect you with our sales team for that question.'), status: 'sent' },
      ]);
      const assistantTurns = messages.filter(item => item.role === 'assistant' && item.status === 'sent').length + 1;
      if (data.offerContact || assistantTurns >= 2 || Number(data.messageCount || 0) >= 4) {
        setContactSuggested(true);
        if (!contactDismissed) recordEvent('contact_cta_shown', { reason: data.offerContact ? 'response_signal' : 'useful_turns' });
      }
      if (nextFit) recordEvent('fit_classified', { fit: data.fit });
    } catch (caught) {
      setMessages(previous => previous.map(item => item.id === messageId
        ? { ...item, status: 'failed', content }
        : item));
    } finally {
      setSending(false);
    }
  };

  const submitComposer = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage(draft);
  };

  const submitHero = (event: FormEvent) => {
    event.preventDefault();
    if (!heroDraft.trim()) return;
    openDialog(event.currentTarget.querySelector('button'));
    recordEvent('hero_prompt_sent');
    void sendMessage(heroDraft);
  };

  const useStarter = (starter: string, opener: HTMLElement) => {
    openDialog(opener);
    recordEvent('suggested_prompt_selected', { starter });
    void sendMessage(starter);
  };

  const deleteConversation = async () => {
    if (!conversationId || sending || !window.confirm('Delete this conversation and its messages?')) return;
    const idempotencyKey = crypto.randomUUID();
    try {
      const response = await fetch('/api/public/sales-assistant/conversation', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ conversationId, idempotencyKey }),
      });
      if (!response.ok && response.status !== 404) throw new Error('Delete failed');
      setConversationId(null);
      setMessages([]);
      setFit(undefined);
      setContactSuggested(false);
      setContactOpen(false);
      setContactDismissed(false);
    } catch {
      setDeleteError('We could not delete the conversation. Please try again.');
    }
  };

  const onComposerKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <>
      {showHeroPrompt && (
        <div className={styles.heroPrompt}>
          <div className={styles.heroPromptHeading}><Sparkles size={16} /><span>Ask about your retail setup</span></div>
          <form onSubmit={submitHero} className={styles.heroInputRow}>
            <input value={heroDraft} onChange={event => setHeroDraft(event.target.value.slice(0, 2_000))} onFocus={() => recordEvent('hero_prompt_focused')} placeholder="e.g. Could this work across our stores and online shop?" aria-label="Ask the Solvantis sales assistant" />
            <button type="submit" disabled={!heroDraft.trim()} aria-label="Send question" title="Send question"><ArrowUp size={18} /></button>
          </form>
          <div className={styles.starters} aria-label="Example questions">
            {STARTERS.map(starter => <button key={starter} type="button" onClick={event => useStarter(starter, event.currentTarget)}>{starter}</button>)}
          </div>
          <p className={styles.heroPrivacy}>Questions and responses are stored to improve Solvantis and may be reviewed. <a href="/privacy">Privacy</a></p>
        </div>
      )}

      {launcherVisible && !open && (
        <button className={styles.launcher} type="button" onClick={event => openDialog(event.currentTarget)} aria-label="Open Solvantis sales assistant" title="Ask Solvantis">
          <MessageCircle size={21} /><span>Ask Solvantis</span>
        </button>
      )}

      {open && (
        <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) closeDialog(); }}>
          <section ref={dialogRef} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="prospect-assistant-title">
            <header className={styles.header}>
              <span className={styles.mark}><Sparkles size={18} /></span>
              <div><h2 id="prospect-assistant-title">Solvantis Sales Assistant</h2><p>Feature and fit guidance for retailers</p></div>
              <button type="button" className={styles.iconButton} onClick={closeDialog} aria-label="Close assistant" title="Close assistant"><X size={20} /></button>
            </header>

            <div className={styles.actionBar}>
              <button type="button" onClick={() => { setContactOpen(true); recordEvent('contact_cta_opened', { source: 'action_bar' }); }}><UserRound size={15} /> Talk to sales</button>
              <button type="button" onClick={deleteConversation} disabled={!conversationId || sending}><Trash2 size={14} /> Delete conversation</button>
            </div>

            <div className={styles.transcript} ref={transcriptRef} aria-live="polite" aria-busy={sending || restoring}>
              {restoring && <div className={styles.statusText}>Restoring your conversation...</div>}
              {!restoring && messages.length === 0 && (
                <div className={styles.welcome}>
                  <Sparkles size={23} />
                  <h3>Tell me what you&apos;re trying to connect or improve.</h3>
                  <p>I can help with feature fit, pricing, locations, integrations and next steps.</p>
                  <div className={styles.welcomeStarters}>{STARTERS.slice(0, 3).map(starter => <button key={starter} onClick={event => useStarter(starter, event.currentTarget)}>{starter}</button>)}</div>
                </div>
              )}
              {messages.map(message => (
                <article key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.userMessage : styles.assistantMessage}`}>
                  <div>{message.content}</div>
                  {message.status === 'sending' && <span className={styles.messageState}>Sending...</span>}
                  {message.status === 'failed' && (
                    <button className={styles.retryButton} type="button" onClick={() => void sendMessage(message.content, message.id)} disabled={sending}><RefreshCw size={13} /> Retry</button>
                  )}
                </article>
              ))}
              {sending && <div className={styles.thinking} aria-label="Solvantis is preparing an answer"><span /><span /><span /></div>}
              {fitLabel(fit) && <p className={styles.fitLabel}>{fitLabel(fit)}</p>}

              {contactSuggested && !contactOpen && !contactDismissed && (
                <div className={styles.contactPrompt}>
                  <div><strong>Want to discuss your setup?</strong><span>A retail specialist can pick up from here.</span></div>
                  <button type="button" onClick={() => { setContactOpen(true); recordEvent('contact_cta_opened', { source: 'suggested' }); }}>Talk to sales</button>
                  <button type="button" className={styles.dismissButton} onClick={() => { setContactDismissed(true); recordEvent('contact_cta_dismissed'); }} aria-label="Dismiss contact suggestion"><X size={15} /></button>
                </div>
              )}

              {contactOpen && (
                <div className={styles.contactForm}>
                  <div className={styles.contactFormHeader}><div><strong>Talk to sales</strong><span>Choose exactly how we may reply.</span></div><button type="button" onClick={() => setContactOpen(false)} aria-label="Close contact form"><X size={17} /></button></div>
                  <ProspectLeadForm compact conversationId={conversationId} sourcePath={sourcePath} onSuccess={reference => recordEvent('lead_captured', { reference })} />
                </div>
              )}
              {deleteError && <p className={styles.errorText} role="alert">{deleteError}</p>}
            </div>

            <form className={styles.composer} onSubmit={submitComposer}>
              {messages.length === 0 && <p>Conversations are stored to improve Solvantis and may be reviewed. <a href="/privacy">Privacy notice</a></p>}
              <div className={styles.composerRow}>
                <textarea ref={inputRef} rows={1} value={draft} onChange={event => setDraft(event.target.value.slice(0, 2_000))} onKeyDown={onComposerKeyDown} placeholder="Ask about features, fit or integrations" aria-label="Message the Solvantis sales assistant" disabled={sending} />
                <button type="submit" disabled={!draft.trim() || sending} aria-label="Send message" title="Send message"><ArrowUp size={18} /></button>
              </div>
              <nav className={styles.contextLinks} aria-label="Explore Solvantis"><a href="/#features">Features</a><a href="/#integrations">Integrations</a><a href="/pricing">Pricing</a><a href="/register">Start trial</a></nav>
            </form>
          </section>
        </div>
      )}
    </>
  );
}