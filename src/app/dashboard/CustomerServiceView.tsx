"use client";

import { useEffect, useMemo, useState } from 'react';
import { AI_DATA_SOURCES } from '@/lib/aiDataSources';

function ToggleChip({ label, icon, active, disabled = false, onClick }: {
  label: string; icon?: string; active: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-300 hover:border-blue-400'
      }`}
    >
      {icon && <span>{icon}</span>}
      {label}
    </button>
  );
}

const CS_DATA_SOURCES = AI_DATA_SOURCES.filter(s =>
  ['businessInfo', 'brandProfile', 'products', 'sales', 'website', 'websiteCollections'].includes(s.id),
);

type TriageItem = {
  threadId: string;
  messageId: string;
  from: string;
  subject: string;
  preview: string;
};

type DraftItem = {
  threadId: string;
  messageId: string;
  replyToMessageId: string;
  references: string;
  from: string;
  subject: string;
  receivedAt: string;
  summary: string;
  customerMessage: string;
  draftResponse: string;
  action?: 'reply' | 'forward';
  forwardTo?: string;
  selected?: boolean;
};

export function CustomerServiceView({ databaseId }: { databaseId: string }) {
  const defaultSources = useMemo(
    () => Object.fromEntries(CS_DATA_SOURCES.map(s => [s.id, true])),
    [],
  );

  const [selected, setSelected] = useState<Record<string, boolean>>(defaultSources);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [triageItems, setTriageItems] = useState<TriageItem[]>([]);
  const [showTriage, setShowTriage] = useState(false);
  const [guidelines, setGuidelines] = useState('');
  const [guidelinesSaving, setGuidelinesSaving] = useState(false);
  const [guidelinesNotice, setGuidelinesNotice] = useState('');
  const [helperEmail, setHelperEmail] = useState('');
  const [helperEmailSaving, setHelperEmailSaving] = useState(false);
  const [helperEmailNotice, setHelperEmailNotice] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // Auto-reply state
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoInterval, setAutoInterval] = useState(60);
  const [autoMode, setAutoMode] = useState<'draft' | 'send'>('draft');
  const [autoForward, setAutoForward] = useState('');
  const [autoDays, setAutoDays] = useState(3);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoNotice, setAutoNotice] = useState('');
  const [autoLastRun, setAutoLastRun] = useState('');
  const [showAutoSettings, setShowAutoSettings] = useState(false);

  // Load saved guidelines and helper email on mount
  useEffect(() => {
    if (!databaseId) return;
    fetch(`/api/user/cs-guidelines?databaseId=${encodeURIComponent(databaseId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.guidelines) setGuidelines(d.guidelines);
        if (d.helperEmail) setHelperEmail(d.helperEmail);
        if (!d.guidelines) setShowSettings(true);
        // Auto-reply settings
        const ar = d.autoReply ?? {};
        setAutoEnabled(ar.CSAutoReplyEnabled === 'true');
        if (ar.CSAutoReplyIntervalMins) setAutoInterval(Number(ar.CSAutoReplyIntervalMins) || 60);
        if (ar.CSAutoReplyMode === 'send') setAutoMode('send'); else setAutoMode('draft');
        if (ar.CSAutoReplyForwardEmails) setAutoForward(ar.CSAutoReplyForwardEmails);
        if (ar.CSAutoReplyDays) setAutoDays(Number(ar.CSAutoReplyDays) || 3);
        if (ar.CSAutoReplyLastRunAt) setAutoLastRun(ar.CSAutoReplyLastRunAt);
      })
      .catch(() => {});
  }, [databaseId]);

  const saveGuidelines = async () => {
    setGuidelinesSaving(true);
    setGuidelinesNotice('');
    try {
      const res = await fetch('/api/user/cs-guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, guidelines, helperEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      setGuidelinesNotice('Saved.');
    } catch (e: any) {
      setGuidelinesNotice(e.message || 'Failed to save.');
    } finally {
      setGuidelinesSaving(false);
    }
  };

  const saveAutoSettings = async () => {
    setGuidelinesSaving(true);
    setGuidelinesNotice('');
    try {
      const res = await fetch('/api/user/cs-guidelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseId, guidelines, helperEmail,
          autoReply: {
            CSAutoReplyEnabled: autoEnabled ? 'true' : 'false',
            CSAutoReplyIntervalMins: String(autoInterval),
            CSAutoReplyMode: autoMode,
            CSAutoReplyForwardEmails: autoForward,
            CSAutoReplyDays: String(autoDays),
            CSAutoReplyDataSources: JSON.stringify(activeSources),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      setGuidelinesNotice('Auto-reply settings saved.');
    } catch (e: any) {
      setGuidelinesNotice(e.message || 'Failed to save.');
    } finally {
      setGuidelinesSaving(false);
    }
  };

  const runAutoNow = async () => {
    setAutoRunning(true); setAutoNotice('');
    try {
      const res = await fetch('/api/customer-service/auto-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Failed');
      if (d.skipped) setAutoNotice(`Skipped: ${d.skipped}`);
      else setAutoNotice(`Done — processed: ${d.processed}, drafted: ${d.drafted}, sent: ${d.sent}, forwarded: ${d.forwarded}`);
    } catch (e: any) { setAutoNotice(`Error: ${e.message}`); }
    finally { setAutoRunning(false); }
  };

  const activeSources = CS_DATA_SOURCES.filter(s => selected[s.id]).map(s => s.id);
  const selectedCount = drafts.filter(d => d.selected).length;

  const runAnswerQueries = async () => {
    if (!databaseId) {
      setError('No business selected.');
      return;
    }
    if (!days || days < 1 || days > 90) {
      setError('Days to search must be between 1 and 90.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const res = await fetch('/api/customer-service/answer-queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, days, dataSources: activeSources, guidelines, helperEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyse inbox.');

      const items: DraftItem[] = (data.items || []).map((item: DraftItem) => ({ ...item, action: item.action ?? 'reply', forwardTo: item.action === 'forward' ? (helperEmail || '') : '', selected: true }));
      setDrafts(items);
      setTriageItems(data.triageItems || []);
      setShowTriage(items.length === 0 && (data.triageItems?.length ?? 0) > 0);
      const debugNote = data.debug?.note ? ` — ${data.debug.note}` : '';
      const debugCounts = data.debug && items.length === 0
        ? ` (inbox messages: ${data.debug.messageCount ?? '?'}, threads checked: ${data.debug.threadCount ?? '?'}, unanswered: ${data.debug.candidateCount ?? '?'})`
        : '';
      if (items.length === 0) {
        setNotice(`No unanswered customer emails found in the last ${days} day${days === 1 ? '' : 's'}.${debugCounts}${debugNote}`);
      } else {
        setNotice(`Found ${items.length} unanswered customer email${items.length === 1 ? '' : 's'} in the last ${days} day${days === 1 ? '' : 's'}.`);
      }
    } catch (e: any) {
      setError(e.message || 'Failed to analyse inbox.');
    } finally {
      setLoading(false);
    }
  };

  const sendChecked = async () => {
    const payload = drafts.filter(d => d.selected);
    if (payload.length === 0) {
      setError('Select at least one draft to send.');
      return;
    }

    setSending(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/customer-service/send-drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseId, drafts: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send drafts.');

      const sentIds = new Set<string>((data.results || []).filter((r: any) => r.success).map((r: any) => r.messageId));
      setDrafts(prev => prev.map(d => (sentIds.has(d.messageId) ? { ...d, selected: false } : d)));

      const sentCount = data.results?.filter((r: any) => r.success).length || 0;
      const failCount = (data.results?.length || 0) - sentCount;
      setNotice(`Sent ${sentCount} email(s)${failCount > 0 ? `, ${failCount} failed` : ''}.`);
    } catch (e: any) {
      setError(e.message || 'Failed to send drafts.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-6xl space-y-5">
      {/* Title row with inline settings cog */}
      <div className="flex items-center gap-2 mb-5">
        <h1 className="text-xl font-bold text-gray-900">Customer Service — Inbox</h1>
        <button
          onClick={() => setShowSettings(v => !v)}
          title="Email Answering Guidelines"
          className={`p-1.5 rounded-lg border transition-colors ${
            showSettings
              ? 'bg-gray-100 border-gray-300 text-gray-600'
              : 'border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200'
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" xmlns="http://www.w3.org/2000/svg">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        </button>
      </div>

      {/* Guidelines panel — auto-shown when empty, toggled via cog */}
      {showSettings && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-2 mb-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="text-gray-400 shrink-0" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            <h3 className="text-sm font-bold text-gray-700">Email Answering Guidelines</h3>
          </div>
          <p className="text-xs text-gray-500 mb-3">These instructions are passed to the AI every time it drafts a reply. Use this to set your preferred tone, sign-off, policies, things to avoid, etc.</p>
          <textarea
            value={guidelines}
            onChange={e => setGuidelines(e.target.value)}
            rows={6}
            placeholder="e.g. Always sign off as the Customer Service Team. Never promise a specific delivery date. If a customer mentions a fault, always offer a replacement first before a refund."
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 resize-y"
          />
          <div className="mt-3 mb-1">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Human Helper Email Address</label>
            <p className="text-xs text-gray-400 mb-2">If an email needs escalating to a human, the AI will suggest forwarding to this address and pre-fill the forward-to field.</p>
            <input
              type="email"
              value={helperEmail}
              onChange={e => setHelperEmail(e.target.value)}
              placeholder="e.g. support-team@yourbusiness.com"
              className="w-full max-w-sm border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={saveGuidelines}
              disabled={guidelinesSaving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {guidelinesSaving ? 'Saving…' : 'Save Guidelines'}
            </button>
            {guidelinesNotice && <span className="text-xs text-gray-500">{guidelinesNotice}</span>}
          </div>
        </div>
      )}

      {/* Auto-Reply settings panel */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
        <button
          onClick={() => setShowAutoSettings(v => !v)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <div className="flex items-center gap-3">
            <span className="text-base">🤖</span>
            <div>
              <span className="text-sm font-bold text-gray-800">Automated Email Replies</span>
              <span className={`ml-2 px-2 py-0.5 text-xs font-semibold rounded-full ${autoEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {autoEnabled ? `ON — every ${autoInterval} min` : 'OFF'}
              </span>
              {autoLastRun && <span className="ml-2 text-xs text-gray-400">Last run: {new Date(autoLastRun).toLocaleString()}</span>}
            </div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform ${showAutoSettings ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
        </button>

        {showAutoSettings && (
          <div className="border-t border-gray-100 px-6 pb-6 pt-4 space-y-4">
            <p className="text-xs text-gray-500 leading-relaxed">
              When enabled, GitHub Actions polls your inbox every 15 minutes and only acts when the configured interval has passed.
              Emails go through the same AI triage + draft process as the manual flow.
            </p>

            {/* Enable toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setAutoEnabled(v => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors ${autoEnabled ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
              <span className="text-sm font-semibold text-gray-700">{autoEnabled ? 'Enabled' : 'Disabled'}</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              {/* Interval */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Poll interval (minutes)</label>
                <input type="number" min={15} max={1440} value={autoInterval} onChange={e => setAutoInterval(Math.max(15, Number(e.target.value || 60)))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">Minimum 15 min. Recommended: 60.</p>
              </div>

              {/* Lookback days */}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Lookback (days)</label>
                <input type="number" min={1} max={14} value={autoDays} onChange={e => setAutoDays(Math.max(1, Math.min(14, Number(e.target.value || 3))))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                <p className="text-xs text-gray-400 mt-1">How far back to look for unanswered emails.</p>
              </div>
            </div>

            {/* Mode */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-2">What to do with AI replies</label>
              <div className="flex gap-3">
                {([['draft', '📝 Create Draft', 'AI creates a draft in your Gmail Drafts folder. You review and send manually.'], ['send', '📤 Send Automatically', 'AI sends the reply immediately. No human review before sending.']] as const).map(([val, label, desc]) => (
                  <button
                    key={val}
                    onClick={() => setAutoMode(val as 'draft' | 'send')}
                    className={`flex-1 rounded-xl border-2 p-3 text-left transition-all ${autoMode === val ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200'}`}
                  >
                    <div className="text-xs font-bold text-gray-800 mb-1">{label}</div>
                    <div className="text-xs text-gray-500">{desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Forward emails */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Forward notification to (comma-separated)</label>
              <input
                type="text"
                value={autoForward}
                onChange={e => setAutoForward(e.target.value)}
                placeholder="e.g. manager@company.com, sales@company.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                After each AI draft or auto-send, a notification email is sent to these addresses containing the AI draft + original thread.
                The recipient can review and — if the mode is Draft — find the ready-to-send draft in Gmail Drafts.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-1 flex-wrap">
              <button onClick={saveAutoSettings} disabled={guidelinesSaving} className="px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {guidelinesSaving ? 'Saving…' : 'Save Auto-Reply Settings'}
              </button>
              <button onClick={runAutoNow} disabled={autoRunning} className="px-4 py-2 bg-gray-700 text-white text-sm font-semibold rounded-lg hover:bg-gray-800 disabled:opacity-50">
                {autoRunning ? 'Running…' : '▶ Run Now'}
              </button>
              {(guidelinesNotice || autoNotice) && <span className="text-xs text-gray-500">{autoNotice || guidelinesNotice}</span>}
            </div>
            <p className="text-xs text-gray-400">
              ⚙️ Auto-reply runs automatically for all businesses that have it enabled. No additional GitHub secrets needed beyond <code className="bg-gray-100 px-1 rounded">CRON_SECRET</code>.
            </p>
          </div>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-700 mb-2">Include business data</p>
        <div className="flex flex-wrap gap-2">
          {CS_DATA_SOURCES.map(source => (
            <ToggleChip
              key={source.id}
              label={source.label}
              icon={source.icon}
              active={!!selected[source.id]}
              onClick={() => setSelected(p => ({ ...p, [source.id]: !p[source.id] }))}
            />
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs font-semibold text-gray-600 block mb-1">How many days should we search?</label>
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value || 7))))}
              className="w-44 border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={runAnswerQueries}
            disabled={loading || sending}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {loading ? 'Scanning Inbox…' : 'Answer Customer Service Queries'}
          </button>

          <button
            onClick={sendChecked}
            disabled={sending || loading || selectedCount === 0}
            className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send Checked Responses (${selectedCount})`}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        {notice && <p className="text-sm text-green-700 mt-3">{notice}</p>}
      </div>

      {triageItems.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm">
          <button
            onClick={() => setShowTriage(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-xl"
          >
            <span>🔍 Triage summary — {triageItems.length} unanswered threads sent to AI for classification</span>
            <span className="text-gray-400 text-xs">{showTriage ? '▲ Hide' : '▼ Show'}</span>
          </button>
          {showTriage && (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-gray-500">
                    <th className="text-left px-4 py-2 font-semibold">From</th>
                    <th className="text-left px-4 py-2 font-semibold">Subject</th>
                    <th className="text-left px-4 py-2 font-semibold">Preview (first 2 sentences sent to AI)</th>
                  </tr>
                </thead>
                <tbody>
                  {triageItems.map((t, i) => (
                    <tr key={`${t.threadId}-${i}`} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700 max-w-48 truncate">{t.from}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-gray-700 max-w-52 truncate">{t.subject || '(No subject)'}</td>
                      <td className="px-4 py-2 text-gray-500 max-w-xl">{t.preview || <span className="italic text-gray-300">No preview</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {drafts.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-gray-400">
            Run "Answer Customer Service Queries" to load unanswered emails and AI drafts.
          </div>
        ) : drafts.map((item, idx) => (
          <div key={`${item.threadId}-${item.messageId}`} className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-3">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={!!item.selected}
                onChange={() => setDrafts(prev => prev.map((d, i) => (i === idx ? { ...d, selected: !d.selected } : d)))}
                className="mt-1 w-4 h-4 accent-green-600"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-800 truncate">{item.subject || '(No subject)'}</p>
                <p className="text-xs text-gray-500 mt-0.5">From: {item.from} · Received: {item.receivedAt}</p>
              </div>
              {/* Action toggle */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, action: 'reply' } : d))}
                  className={`px-3 py-1 text-xs font-semibold rounded-l-lg border ${
                    item.action !== 'forward' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  ↩ Reply
                </button>
                <button
                  onClick={() => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, action: 'forward', forwardTo: d.forwardTo || helperEmail } : d))}
                  className={`px-3 py-1 text-xs font-semibold rounded-r-lg border-t border-r border-b ${
                    item.action === 'forward' ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  ➡ Forward
                </button>
              </div>
            </div>

            {item.action === 'forward' && (
              <div className="flex items-center gap-2">
                <label className="text-xs font-semibold text-gray-600 whitespace-nowrap">Forward to:</label>
                <input
                  type="email"
                  value={item.forwardTo ?? ''}
                  onChange={e => setDrafts(prev => prev.map((d, i) => i === idx ? { ...d, forwardTo: e.target.value } : d))}
                  placeholder={helperEmail || 'helper@example.com'}
                  className="flex-1 max-w-xs border border-orange-300 rounded-lg px-2 py-1 text-sm"
                />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-gray-600 mb-1">Detected Customer Query</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.customerMessage}</p>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-semibold text-blue-700 mb-1">AI Draft Response</p>
                <textarea
                  value={item.draftResponse}
                  onChange={e => setDrafts(prev => prev.map((d, i) => (i === idx ? { ...d, draftResponse: e.target.value } : d)))}
                  rows={8}
                  className="w-full text-sm text-gray-800 bg-white border border-blue-200 rounded p-2"
                />
              </div>
            </div>

            {item.summary && <p className="text-xs text-gray-500">AI rationale: {item.summary}</p>}
          </div>
        ))}
      </div>

      {drafts.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={sendChecked}
            disabled={sending || loading || selectedCount === 0}
            className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
          >
            {sending ? 'Sending…' : `Send Checked Responses (${selectedCount})`}
          </button>
        </div>
      )}
    </div>
  );
}
