'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowUp, BookOpen, Check, Database, MessageCircle, Sparkles, X } from 'lucide-react';

import styles from './SolvantisAssistantPanel.module.css';

interface Citation {
  title: string;
  section: string;
  screen: string;
  topicId?: string;
  sectionId?: string;
}

interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  toolsUsed?: string[];
  candidateToken?: string | null;
  reviewSent?: boolean;
}

const LIVE_CHECK_LABELS: Record<string, string> = {
  ims_product_lookup: 'Products and stock',
  ims_order_summary: 'Order detail',
  ims_order_search: 'Recent orders',
  ims_stock_alerts: 'Stock exceptions',
  pos_product_lookup: 'Location products and stock',
  pos_session_context: 'Register context',
  wholesale_catalogue_lookup: 'Approved catalogue',
  wholesale_order_summary: 'Account order',
  wholesale_account_summary: 'Account terms',
};

function readVisibleScreenContext(currentView?: string | null): unknown {
  if (!currentView || typeof document === 'undefined') return null;
  const workspace = document.querySelector<HTMLElement>('main');
  const screenOutline = workspace ? Array.from(workspace.querySelectorAll<HTMLElement>('h1, h2, h3, th, label, [role="tab"][aria-selected="true"]'))
    .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden')
    .map(element => {
      if (element.tagName !== 'LABEL') return element.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) || '';
      return Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    })
    .filter((text, index, all) => Boolean(text) && all.indexOf(text) === index)
    .slice(0, 60) : [];
  const element = Array.from(document.querySelectorAll<HTMLElement>('[data-assistant-context]'))
    .find(candidate => candidate.dataset.assistantContext === currentView);
  const serialized = element?.dataset.assistantScreenContext;
  if (!serialized) return screenOutline.length > 0 ? { screen: currentView, screenOutline } : null;
  try {
    const declared = JSON.parse(serialized);
    return declared && typeof declared === 'object' && !Array.isArray(declared)
      ? { ...declared, screenOutline }
      : { screen: currentView, screenOutline };
  } catch {
    return screenOutline.length > 0 ? { screen: currentView, screenOutline } : null;
  }
}

export function SolvantisAssistantPanel({
  chatEndpoint,
  escalationEndpoint,
  currentView,
  disabled = false,
  disabledLabel = 'Assistant needs an internet connection',
  side = 'right',
  embedded = false,
  onCitationOpen,
}: {
  chatEndpoint: string;
  escalationEndpoint: string;
  currentView?: string | null;
  disabled?: boolean;
  disabledLabel?: string;
  side?: 'left' | 'right';
  embedded?: boolean;
  onCitationOpen?: (citation: Citation) => void;
}) {
  const [open, setOpen] = useState(embedded);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || sending || disabled) return;
    const userEntry: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: message };
    const history = messages.slice(-6).map(item => ({ role: item.role, content: item.content }));
    setMessages(previous => [...previous, userEntry]);
    setDraft('');
    setSending(true);
    try {
      const response = await fetch(chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, currentView, screenContext: readVisibleScreenContext(currentView) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Assistant is unavailable right now.');
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: String(data.answer || 'I could not prepare an answer.'),
        citations: Array.isArray(data.citations) ? data.citations : [],
        toolsUsed: Array.isArray(data.toolsUsed) ? data.toolsUsed.map(String).filter(tool => LIVE_CHECK_LABELS[tool]) : [],
        candidateToken: typeof data.candidateToken === 'string' ? data.candidateToken : null,
      }]);
    } catch (error) {
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: error instanceof Error ? error.message : 'Assistant is unavailable right now.',
      }]);
    } finally {
      setSending(false);
    }
  };

  const requestReview = async (entry: ChatEntry) => {
    if (!entry.candidateToken || sending) return;
    setSending(true);
    try {
      const response = await fetch(escalationEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateToken: entry.candidateToken }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The review request could not be sent.');
      setMessages(previous => previous.map(message => message.id === entry.id
        ? { ...message, candidateToken: null, reviewSent: true }
        : message).concat({
          id: crypto.randomUUID(), role: 'assistant', content: String(data.answer || 'The review request has been sent.'),
        }));
    } catch (error) {
      setMessages(previous => [...previous, {
        id: crypto.randomUUID(), role: 'assistant',
        content: error instanceof Error ? error.message : 'The review request could not be sent.',
      }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`${embedded ? styles.embeddedRoot : styles.root} ${side === 'left' ? styles.left : styles.right} ${open ? styles.open : ''}`}>
      {open && (
        <section className={styles.panel} role="dialog" aria-modal="false" aria-labelledby="solvantis-assistant-title">
          <header className={styles.header}>
            <span className={styles.mark}><Sparkles size={17} /></span>
            <div>
              <h2 id="solvantis-assistant-title">Solvantis Assistant</h2>
              <span>Business help and live lookups</span>
            </div>
            {!embedded && (
              <button className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close assistant" title="Close assistant">
                <X size={19} />
              </button>
            )}
          </header>

          <div className={styles.messages} ref={scrollRef} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.empty}>
                <Sparkles size={22} />
                <strong>How can I help?</strong>
              </div>
            )}
            {messages.map(message => (
              <article key={message.id} className={`${styles.message} ${message.role === 'user' ? styles.user : styles.assistant}`}>
                <div>{message.content}</div>
                {message.toolsUsed && message.toolsUsed.length > 0 && (
                  <div className={styles.liveChecks}>
                    <Database size={12} /> Checked live: {Array.from(new Set(message.toolsUsed.map(tool => LIVE_CHECK_LABELS[tool]))).join(', ')}
                  </div>
                )}
                {message.citations && message.citations.length > 0 && (
                  <div className={styles.citations} aria-label="Sources">
                    {message.citations.map((citation, index) => (
                      <button
                        key={`${citation.title}-${citation.section}-${index}`}
                        type="button"
                        title={citation.screen}
                        disabled={!citation.topicId || !onCitationOpen}
                        onClick={() => onCitationOpen?.(citation)}
                      >
                        <BookOpen size={12} /> {citation.title}: {citation.section}
                      </button>
                    ))}
                  </div>
                )}
                {message.candidateToken && (
                  <button className={styles.reviewButton} onClick={() => requestReview(message)} disabled={sending}>
                    Send for review
                  </button>
                )}
                {message.reviewSent && <span className={styles.reviewSent}><Check size={13} /> Review sent</span>}
              </article>
            ))}
            {sending && <div className={styles.thinking}><span /><span /><span /></div>}
          </div>

          <form className={styles.composer} onSubmit={submit}>
            {disabled && <div className={styles.disabledNotice}>{disabledLabel}</div>}
            <div className={styles.inputRow}>
              <textarea
                ref={inputRef}
                value={draft}
                onChange={event => setDraft(event.target.value.slice(0, 2_000))}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Ask Solvantis"
                aria-label="Message Solvantis Assistant"
                rows={1}
                disabled={disabled || sending}
              />
              <button type="submit" className={styles.sendButton} disabled={!draft.trim() || disabled || sending} aria-label="Send message" title="Send message">
                <ArrowUp size={18} />
              </button>
            </div>
          </form>
        </section>
      )}

      {!embedded && <button
        className={styles.trigger}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-label={open ? 'Close Solvantis Assistant' : 'Open Solvantis Assistant'}
        title={disabled ? disabledLabel : 'Solvantis Assistant'}
      >
        {open ? <X size={20} /> : <MessageCircle size={21} />}
      </button>}
    </div>
  );
}