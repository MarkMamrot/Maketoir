'use client';

import { useEffect, useRef, useState } from 'react';
import { RefreshCw, Search, X } from 'lucide-react';
import type { CronJobId } from '@/lib/cron/catalog';

interface CronJob {
  id: CronJobId;
  name: string;
  category: string;
  schedule: string | null;
  enabled: boolean;
  warning?: string;
  updatedAt: string | null;
}

export default function CronJobsView() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ job: CronJob; enabled: boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  async function load() {
    setLoading(true);
    setLoaded(false);
    setError('');
    try {
      const response = await fetch('/api/admin/cron-jobs', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.jobs)) throw new Error(data.error || 'Cron Jobs could not be loaded.');
      setJobs(data.jobs);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cron Jobs could not be loaded.');
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
    if (!pending && dialog.current?.open) dialog.current.close();
  }, [pending]);

  async function confirmChange() {
    if (!pending || saving) return;
    const change = pending;
    setPending(null);
    setSaving(change.job.id);
    setError('');
    try {
      const response = await fetch('/api/admin/cron-jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: change.job.id, enabled: change.enabled, confirmed: true }),
      });
      const data = await response.json();
      if (!response.ok || data.success !== true || data.jobId !== change.job.id || data.enabled !== change.enabled) {
        throw new Error(data.error || 'Cron job switch could not be saved.');
      }
      setJobs(current => current.map(job => job.id === change.job.id ? { ...job, enabled: data.enabled, updatedAt: new Date().toISOString() } : job));
    } catch (caught) {
      setLoaded(false);
      setError(`${caught instanceof Error ? caught.message : 'Cron job switch could not be saved.'} Refresh status before another change.`);
    } finally { setSaving(''); }
  }

  const categories = Array.from(new Set(jobs.map(job => job.category))).sort();
  const visibleJobs = jobs.filter(job =>
    (category === 'all' || job.category === category)
    && (status === 'all' || job.enabled === (status === 'on'))
    && `${job.name} ${job.category}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const onCount = jobs.filter(job => job.enabled).length;

  return <section className="cron-jobs" aria-labelledby="cron-jobs-title">
    <header className="cron-heading">
      <div>
        <h1 id="cron-jobs-title">Cron Jobs</h1>
        <p>{loaded ? `${jobs.length} jobs, ${onCount} on, ${jobs.length - onCount} off` : loading ? 'Loading status...' : 'Status unavailable'} <span>Platform-wide</span></p>
      </div>
      <button className="cron-icon-button" aria-label="Refresh cron job status" title="Refresh status" onClick={() => void load()} disabled={loading || Boolean(saving)}><RefreshCw size={18} /></button>
    </header>

    <div className="cron-filters">
      <label className="cron-search"><Search size={16} aria-hidden="true" /><input aria-label="Search cron jobs" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search jobs" /></label>
      <select aria-label="Job category" value={category} onChange={event => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select>
      <select aria-label="Job status" value={status} onChange={event => setStatus(event.target.value)}><option value="all">All statuses</option><option value="on">On</option><option value="off">Off</option></select>
    </div>

    {error && <p role="alert" className="cron-error">{error}</p>}
    <div className="cron-list" aria-busy={loading || Boolean(saving)}>
      <div className="cron-row cron-columns" aria-hidden="true"><span>Job</span><span>Category</span><span>Schedule (UTC)</span><span>Global status</span></div>
      {visibleJobs.map(job => <div className="cron-row" key={job.id}>
        <div className="cron-name"><strong>{job.name}</strong>{job.updatedAt && <small>Updated {new Date(job.updatedAt).toLocaleString('en-AU')}</small>}</div>
        <span className="cron-category">{job.category}</span>
        <span className="cron-schedule">{job.schedule ? <code title="UTC cron schedule">{job.schedule}</code> : 'External trigger only'}</span>
        <div className="cron-status">
          <span className={job.enabled ? 'cron-on' : 'cron-off'}>{saving === job.id ? 'Saving...' : job.enabled ? 'On' : 'Off'}</span>
          <button type="button" role="switch" aria-checked={job.enabled} aria-label={job.name} title={`Turn ${job.enabled ? 'off' : 'on'} ${job.name}`} disabled={!loaded || loading || Boolean(saving) || Boolean(pending)} onClick={() => setPending({ job, enabled: !job.enabled })} className={`cron-switch ${job.enabled ? 'cron-switch-on' : ''}`}><span /></button>
        </div>
      </div>)}
      {!loading && loaded && visibleJobs.length === 0 && <p className="cron-empty">No matching jobs.</p>}
    </div>

    <dialog ref={dialog} className="cron-confirm" aria-labelledby="cron-confirm-title" onCancel={event => { event.preventDefault(); setPending(null); }}>
      <div className="cron-confirm-heading"><h2 id="cron-confirm-title">Turn {pending?.enabled ? 'on' : 'off'} scheduled job?</h2><button className="cron-icon-button" aria-label="Close confirmation" title="Close" onClick={() => setPending(null)}><X size={18} /></button></div>
      <p><strong>{pending?.job.name}</strong></p>
      <p>This change applies to all businesses. {pending?.enabled ? 'Future scheduled runs can resume, subject to existing business and integration settings.' : 'Future scheduled runs will be skipped. Runs already in progress are not cancelled.'}</p>
      {!pending?.enabled && pending?.job.warning && <p className="cron-warning">{pending.job.warning}</p>}
      <div className="cron-confirm-actions"><button onClick={() => setPending(null)}>Cancel</button><button className="cron-confirm-save" onClick={() => void confirmChange()}>Turn {pending?.enabled ? 'on' : 'off'}</button></div>
    </dialog>

    <style jsx>{`
      .cron-jobs { color: var(--sv-text-main,#e2e8f0); font-size: 13px; }
      .cron-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
      h1 { margin: 0; font-size: 22px; font-weight: 700; }
      .cron-heading p { margin: 7px 0 0; color: var(--sv-text-dim,#94a3b8); }
      .cron-heading p span { margin-left: 12px; color: var(--sv-text-main,#e2e8f0); }
      button, input, select { font: inherit; }
      button { cursor: pointer; }
      button:disabled { cursor: default; opacity: .45; }
      .cron-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; flex-shrink: 0; border: 1px solid var(--sv-etch,rgba(255,255,255,.15)); border-radius: 6px; background: var(--sv-bg-1,#1e293b); color: inherit; }
      .cron-filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
      .cron-search { display: flex; align-items: center; gap: 8px; flex: 1 1 240px; min-width: 0; padding: 0 10px; border: 1px solid var(--sv-etch,rgba(255,255,255,.15)); border-radius: 6px; background: var(--sv-bg-1,#1e293b); }
      .cron-search input { width: 100%; min-width: 0; height: 36px; border: 0; outline-offset: 2px; background: transparent; color: inherit; }
      select { max-width: 100%; height: 38px; border: 1px solid var(--sv-etch,rgba(255,255,255,.15)); border-radius: 6px; background: var(--sv-bg-1,#1e293b); color: inherit; padding: 0 10px; }
      .cron-row { display: grid; grid-template-columns: minmax(180px,2fr) minmax(110px,1fr) minmax(145px,1fr) 105px; gap: 16px; align-items: center; padding: 15px 10px; border-bottom: 1px solid var(--sv-etch,rgba(255,255,255,.1)); }
      .cron-columns { padding-top: 10px; padding-bottom: 10px; color: var(--sv-text-dim,#94a3b8); font-size: 11px; background: var(--sv-bg-1,#1e293b); }
      .cron-name { min-width: 0; overflow-wrap: anywhere; }
      .cron-name strong { font-weight: 600; }
      .cron-name small { display: block; margin-top: 5px; color: var(--sv-text-dim,#94a3b8); font-size: 11px; }
      .cron-category, .cron-schedule { color: var(--sv-text-dim,#94a3b8); overflow-wrap: anywhere; }
      .cron-schedule code { font-size: 12px; }
      .cron-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .cron-on { color: var(--sv-success,#15966b); font-weight: 600; }
      .cron-off { color: var(--sv-text-dim,#94a3b8); }
      .cron-switch { position: relative; width: 40px; height: 24px; flex-shrink: 0; border: 0; border-radius: 12px; background: #64748b; padding: 3px; }
      .cron-switch span { display: block; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
      .cron-switch-on { background: #15966b; }
      .cron-switch-on span { transform: translateX(16px); }
      .cron-error { padding: 12px; border-left: 3px solid #e05252; background: rgba(224,82,82,.1); color: var(--sv-text-main,#fca5a5); }
      .cron-empty { padding: 18px 10px; color: var(--sv-text-dim,#94a3b8); }
      .cron-confirm { width: 460px; max-width: calc(100vw - 40px); box-sizing: border-box; border: 1px solid var(--sv-etch,rgba(255,255,255,.2)); border-radius: 8px; padding: 22px; background: var(--sv-bg-1,#1e293b); color: var(--sv-text-main,#e2e8f0); }
      .cron-confirm::backdrop { background: rgba(0,0,0,.55); }
      .cron-confirm-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .cron-confirm h2 { font-size: 18px; margin: 0; }
      .cron-confirm p { line-height: 1.6; }
      .cron-warning { border-left: 3px solid #d99a20; padding-left: 12px; }
      .cron-confirm-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
      .cron-confirm-actions button { border: 1px solid var(--sv-etch,rgba(255,255,255,.2)); border-radius: 6px; background: transparent; color: inherit; padding: 8px 16px; }
      .cron-confirm-actions .cron-confirm-save { background: #12836e; color: #fff; border-color: #12836e; }
      @media (max-width: 1050px) { .cron-row { grid-template-columns: minmax(180px,2fr) 135px 105px; } .cron-category { display: none; } .cron-columns span:nth-child(2) { display: none; } }
      @media (max-width: 600px) { .cron-columns { display: none; } .cron-row { grid-template-columns: minmax(0,1fr) 105px; gap: 8px 12px; padding: 16px 0; } .cron-name { grid-column: 1; grid-row: 1; } .cron-status { grid-column: 2; grid-row: 1 / span 2; } .cron-schedule { grid-column: 1; grid-row: 2; font-size: 11px; } .cron-heading p span { display: block; margin: 5px 0 0; } }
    `}</style>
  </section>;
}