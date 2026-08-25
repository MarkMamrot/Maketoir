'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, BookOpen, Box, Check, ChevronLeft, ClipboardCheck, Clock3,
  Megaphone, PackageOpen, Plus, Search, Settings2, ShoppingBag, Sparkles,
  Truck, UserRoundCheck, X,
} from 'lucide-react';
import type { PosSession } from '../../_types';
import styles from './PosStoreDaybook.module.css';

type Staff = { id?: number | null; name: string; initials: string };
type Task = { id: number; phase: 'opening' | 'during_day' | 'closing'; title_snapshot: string; instructions_snapshot?: string; status: string; last_staff_name?: string; last_staff_initials?: string; signed_at?: string };
type Communication = { id: number; title: string; message: string; priority: string; is_pinned: number; published_at: string; read_count: number; my_read: number };
type RecordRow = { id: number; record_type: string; status: string; title: string; details_json: Record<string, unknown> | string; created_at: string; staff_name: string; staff_initials: string; destination_location_id?: number | null };
type ReferenceRow = { id: number; category: string; title: string; content: string; link_url?: string | null };
type GuideRow = { id: number; sku?: string | null; product_name: string; category?: string | null; shelf_location?: string | null; box_location?: string | null; guidance?: string | null; image_url?: string | null; image_alt?: string | null; status: string };
type Location = { id: number; name: string };
type Workspace = {
  date: string;
  location: Location;
  permissions: { manager: boolean };
  tasks: Task[];
  communications: Communication[];
  records: RecordRow[];
  references: ReferenceRow[];
  guides: GuideRow[];
  staff: Staff[];
  locations: Location[];
};

const sections = [
  ['today', 'Today', ClipboardCheck],
  ['communications', 'Comms', Megaphone],
  ['customer_request', 'Requests', ShoppingBag],
  ['store_need', 'Store needs', Truck],
  ['stock_discrepancy', 'Discrepancies', AlertTriangle],
  ['incident', 'Incidents', Clock3],
  ['references', 'References', BookOpen],
  ['guides', 'Product guide', Box],
] as const;

function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function detailsOf(record: RecordRow): Record<string, unknown> {
  if (typeof record.details_json === 'object' && record.details_json) return record.details_json;
  try { return JSON.parse(record.details_json); } catch { return {}; }
}

function shortTime(value?: string) {
  if (!value) return '';
  return new Date(value.replace(' ', 'T') + (value.includes('Z') ? '' : 'Z')).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function PosStoreDaybook({ session, onBack }: { session: PosSession; onBack: () => void }) {
  const [date, setDate] = useState(todayLocal);
  const [active, setActive] = useState<string>('today');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [staff, setStaff] = useState<Staff | null>(null);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityName, setIdentityName] = useState('');
  const [identityInitials, setIdentityInitials] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});

  const identityKey = `pos_daybook_staff_${session.location_id}_${date}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(identityKey);
      setStaff(saved ? JSON.parse(saved) : null);
      setIdentityOpen(!saved);
    } catch { setStaff(null); setIdentityOpen(true); }
  }, [identityKey]);

  async function load(selectedStaff = staff) {
    setLoading(true);
    setError('');
    try {
      const initials = selectedStaff?.initials ? `&initials=${encodeURIComponent(selectedStaff.initials)}` : '';
      const response = await fetch(`/api/pos/daybook?date=${date}${initials}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Daybook could not be loaded.');
      setWorkspace(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Daybook could not be loaded.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(action: string, payload: Record<string, unknown> = {}, requireStaff = true) {
    if (requireStaff && !staff) { setIdentityOpen(true); throw new Error('Choose your staff identity first.'); }
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/pos/daybook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...payload,
          ...(staff ? { staff_identity_id: staff.id, staff_name: staff.name, staff_initials: staff.initials } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'The action could not be completed.');
      return result;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'The action could not be completed.';
      setError(message);
      throw caught;
    } finally { setSaving(false); }
  }

  async function saveIdentity(existing?: Staff) {
    const source = existing ?? { name: identityName, initials: identityInitials };
    try {
      const result = await post('save_identity', source, false);
      setStaff(result.staff);
      localStorage.setItem(identityKey, JSON.stringify(result.staff));
      setIdentityOpen(false);
      setIdentityName('');
      setIdentityInitials('');
      await load(result.staff);
    } catch {}
  }

  async function perform(action: string, payload: Record<string, unknown> = {}) {
    try { await post(action, payload); setForm({}); await load(); } catch {}
  }

  const records = workspace?.records.filter(record => record.record_type === active) ?? [];
  const completed = workspace?.tasks.filter(task => task.status === 'completed').length ?? 0;
  const total = workspace?.tasks.length ?? 0;
  const unread = workspace?.communications.filter(item => !Number(item.my_read)).length ?? 0;

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <button className={styles.iconButton} onClick={onBack} aria-label="Back to POS"><ChevronLeft /></button>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Sparkles size={19} /></span>
          <div><h1>Store Daybook</h1><p>{session.location_name} · one place for today</p></div>
        </div>
        <div className={styles.headerTools}>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Daybook date" />
          <button className={styles.identityButton} onClick={() => setIdentityOpen(true)}>
            <UserRoundCheck size={17} /> {staff ? `${staff.name} (${staff.initials})` : 'Choose staff'}
          </button>
        </div>
      </header>

      <div className={styles.progressBand}>
        <div><strong>{completed}/{total}</strong><span>tasks signed off</span></div>
        <div className={styles.progressTrack}><span style={{ width: total ? `${completed / total * 100}%` : '0%' }} /></div>
        <button onClick={() => setActive('communications')} className={unread ? styles.unreadButton : styles.quietButton}>
          <Megaphone size={16} /> {unread ? `${unread} unread` : 'Comms read'}
        </button>
      </div>

      <nav className={styles.tabs} aria-label="Daybook sections">
        {sections.map(([id, label, Icon]) => (
          <button key={id} className={active === id ? styles.activeTab : ''} onClick={() => setActive(id)}>
            <Icon size={17} /><span>{label}</span>
            {id === 'communications' && unread > 0 && <b>{unread}</b>}
          </button>
        ))}
        {workspace?.permissions.manager && (
          <button className={active === 'manager' ? styles.activeTab : ''} onClick={() => setActive('manager')}><Settings2 size={17} /><span>Manage</span></button>
        )}
      </nav>

      <main className={styles.main}>
        {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
        {loading && <div className={styles.loading}>Opening the Daybook…</div>}

        {!loading && active === 'today' && (
          <div className={styles.taskColumns}>
            {([['opening', 'Open the store', '#e9684b'], ['during_day', 'Keep the day moving', '#159a91'], ['closing', 'Close with confidence', '#d99b23']] as const).map(([phase, label, colour]) => {
              const tasks = workspace?.tasks.filter(task => task.phase === phase) ?? [];
              return <section className={styles.taskSection} key={phase} style={{ '--accent': colour } as React.CSSProperties}>
                <div className={styles.sectionHeading}><div><span>{phase === 'opening' ? 'START' : phase === 'closing' ? 'END' : 'TODAY'}</span><h2>{label}</h2></div><b>{tasks.filter(task => task.status === 'completed').length}/{tasks.length}</b></div>
                {tasks.length === 0 && <p className={styles.empty}>No tasks are scheduled for this section.</p>}
                {tasks.map(task => <article className={task.status === 'completed' ? styles.taskDone : styles.task} key={task.id}>
                  <button disabled={saving} onClick={() => perform('sign_task', { instance_id: task.id, signoff_action: task.status === 'completed' ? 'reopened' : 'completed', reason: task.status === 'completed' ? 'Manager reopened from Daybook' : '' })} aria-label={`${task.status === 'completed' ? 'Reopen' : 'Complete'} ${task.title_snapshot}`}>
                    {task.status === 'completed' && <Check size={18} />}
                  </button>
                  <div><h3>{task.title_snapshot}</h3>{task.instructions_snapshot && <p>{task.instructions_snapshot}</p>}{task.status === 'completed' && <small>Signed by {task.last_staff_name} ({task.last_staff_initials}) · {shortTime(task.signed_at)}</small>}</div>
                </article>)}
              </section>;
            })}
          </div>
        )}

        {!loading && active === 'communications' && (
          <section className={styles.contentSection}>
            <Title title="Store communications" subtitle="Latest first. Open each notice and acknowledge it under your staff identity." />
            <div className={styles.feed}>{workspace?.communications.map(item => <article className={`${styles.notice} ${item.priority !== 'normal' ? styles.noticeImportant : ''}`} key={item.id}>
              <div className={styles.noticeMeta}><span>{item.priority}</span><time>{shortTime(item.published_at)}</time></div>
              <h3>{item.title}</h3><p>{item.message}</p>
              <footer><small>{item.read_count} acknowledgment{Number(item.read_count) === 1 ? '' : 's'}</small><button disabled={saving || Boolean(Number(item.my_read))} onClick={() => perform('read_communication', { communication_id: item.id })}>{Number(item.my_read) ? <><Check size={16} /> Read</> : 'Mark as read'}</button></footer>
            </article>)}</div>
          </section>
        )}

        {!loading && ['customer_request', 'store_need', 'stock_discrepancy', 'incident'].includes(active) && (
          <RecordSection type={active} records={records} locations={workspace?.locations ?? []} form={form} setForm={setForm} saving={saving} perform={perform} manager={Boolean(workspace?.permissions.manager)} />
        )}

        {!loading && active === 'references' && (
          <section className={styles.contentSection}>
            <Title title="Reference desk" subtitle="Contacts, guides and troubleshooting without hunting through old tabs." />
            <SearchBox value={query} onChange={setQuery} placeholder="Search references" />
            <div className={styles.referenceGrid}>{workspace?.references.filter(item => `${item.title} ${item.content} ${item.category}`.toLowerCase().includes(query.toLowerCase())).map(item => <article className={styles.reference} key={item.id}><span>{item.category}</span><h3>{item.title}</h3><p>{item.content}</p>{item.link_url && <a href={item.link_url} target="_blank" rel="noreferrer">Open resource</a>}</article>)}</div>
          </section>
        )}

        {!loading && active === 'guides' && (
          <section className={styles.contentSection}>
            <Title title="Product guide" subtitle="Find products, display positions and storage boxes at a glance." />
            <SearchBox value={query} onChange={setQuery} placeholder="Search product, SKU, shelf or box" />
            <div className={styles.guideGrid}>{workspace?.guides.filter(item => `${item.product_name} ${item.sku} ${item.category} ${item.shelf_location} ${item.box_location}`.toLowerCase().includes(query.toLowerCase())).map(item => <article className={styles.guide} key={item.id}>
              <div className={styles.guideImage}>{item.image_url ? <img src={item.image_url} alt={item.image_alt || item.product_name} /> : <><PackageOpen size={28} /><span>Photo coming soon</span></>}</div>
              <div><span>{item.category || 'Product'}{item.sku ? ` · ${item.sku}` : ''}</span><h3>{item.product_name}</h3><dl><dt>Shelf</dt><dd>{item.shelf_location || 'To be mapped'}</dd><dt>Box</dt><dd>{item.box_location || 'To be mapped'}</dd></dl>{item.guidance && <p>{item.guidance}</p>}</div>
            </article>)}</div>
          </section>
        )}

        {!loading && active === 'manager' && workspace?.permissions.manager && <ManagerTools form={form} setForm={setForm} locations={workspace.locations} saving={saving} perform={perform} />}
      </main>

      {identityOpen && <div className={styles.modalBackdrop} role="presentation"><div className={styles.identityModal} role="dialog" aria-modal="true" aria-labelledby="identity-title">
        <button className={styles.modalClose} onClick={() => staff && setIdentityOpen(false)} aria-label="Close"><X /></button>
        <UserRoundCheck size={30} /><h2 id="identity-title">Who is using the Daybook?</h2><p>The signed-in account is still recorded. Choose your name or enter it for this shift.</p>
        {workspace?.staff.length ? <div className={styles.staffChoices}>{workspace.staff.map(item => <button key={item.id} onClick={() => saveIdentity(item)}><b>{item.initials}</b><span>{item.name}</span></button>)}</div> : null}
        <div className={styles.or}><span>or enter staff details</span></div>
        <label>Name<input value={identityName} onChange={event => setIdentityName(event.target.value)} placeholder="Staff name" /></label>
        <label>Initials<input value={identityInitials} onChange={event => setIdentityInitials(event.target.value)} placeholder="e.g. HG" maxLength={8} /></label>
        <button className={styles.primary} disabled={saving || !identityName.trim()} onClick={() => saveIdentity()}>Continue as this staff member</button>
        <small>Account audit: {session.full_name}</small>
      </div></div>}
    </div>
  );
}

function Title({ title, subtitle }: { title: string; subtitle: string }) { return <div className={styles.title}><h2>{title}</h2><p>{subtitle}</p></div>; }
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className={styles.search}><Search size={17} /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>; }

function Field({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value?: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className={styles.field}><span>{label}</span>{type === 'textarea' ? <textarea value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} /> : <input type={type} value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} />}</label>;
}

function RecordSection({ type, records, locations, form, setForm, saving, perform, manager }: { type: string; records: RecordRow[]; locations: Location[]; form: Record<string, string>; setForm: (form: Record<string, string>) => void; saving: boolean; perform: (action: string, payload?: Record<string, unknown>) => Promise<void>; manager: boolean }) {
  const meta: Record<string, [string, string]> = {
    customer_request: ['Customer requests', 'Record sold-out products and follow up without losing the customer thread.'],
    store_need: ['Store needs', 'Ask the warehouse for consumables or stock, then follow it through dispatch.'],
    stock_discrepancy: ['Stock discrepancies', 'Capture what the system says and what you found for a manager stocktake.'],
    incident: ['Incident reports', 'Record the facts carefully and sign the report before submitting it.'],
  };
  const detailFields: Record<string, string[]> = {
    customer_request: ['customer_name', 'contact_details', 'item', 'notes'],
    store_need: ['item', 'quantity', 'unit', 'store_notes'],
    stock_discrepancy: ['sku', 'item', 'size', 'system_quantity', 'physical_quantity', 'notes'],
    incident: ['time', 'staff_present', 'event_description', 'loss_or_damage', 'emergency_services', 'instigator_description', 'management_notified'],
  };
  const labels: Record<string, string> = { customer_name: 'Customer name', contact_details: 'Contact details', item: 'Item', notes: 'Notes', quantity: 'Quantity', unit: 'Unit', store_notes: 'Store notes', sku: 'SKU / code', size: 'Size', system_quantity: 'System quantity', physical_quantity: 'Physical quantity found', time: 'Time', staff_present: 'Staff present', event_description: 'Event description', loss_or_damage: 'Loss or damage', emergency_services: 'Emergency services called?', instigator_description: 'Description of incident instigator', management_notified: 'Has management been told?' };
  const title = type === 'incident' ? 'Incident report' : form.item || form.customer_name || '';
  async function submit() {
    const details = Object.fromEntries(detailFields[type].map(key => [key, form[key] || '']));
    await perform('create_record', { record_type: type, title, occurred_on: form.occurred_on || todayLocal(), destination_location_id: form.destination_location_id || null, details });
  }
  return <section className={styles.contentSection}>
    <Title title={meta[type][0]} subtitle={meta[type][1]} />
    <div className={styles.split}>
      <form className={styles.entryForm} onSubmit={event => { event.preventDefault(); void submit(); }}>
        <h3><Plus size={18} /> New {meta[type][0].toLowerCase().replace(/s$/, '')}</h3>
        <Field label={type === 'incident' ? 'Day and date' : 'Date'} type="date" value={form.occurred_on || todayLocal()} onChange={value => setForm({ ...form, occurred_on: value })} />
        {detailFields[type].map(key => <Field key={key} label={labels[key]} type={['notes', 'store_notes', 'event_description', 'instigator_description'].includes(key) ? 'textarea' : ['system_quantity', 'physical_quantity', 'quantity'].includes(key) ? 'number' : 'text'} value={form[key]} onChange={value => setForm({ ...form, [key]: value })} />)}
        {type === 'store_need' && <label className={styles.field}><span>Send to</span><select value={form.destination_location_id || ''} onChange={event => setForm({ ...form, destination_location_id: event.target.value })}><option value="">Select warehouse</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}
        {type === 'incident' && <div className={styles.privacyNote}>Incident details are restricted to managers after submission. Do not include unnecessary personal information.</div>}
        <button className={styles.primary} disabled={saving || !title.trim()}>{type === 'incident' ? 'Sign and submit report' : 'Add to Daybook'}</button>
      </form>
      <div className={styles.recordList}>{records.length === 0 && <p className={styles.empty}>Nothing recorded here yet.</p>}{records.map(record => {
        const details = detailsOf(record);
        return <article className={styles.record} key={record.id}><div className={styles.recordTop}><span>{record.status.replaceAll('_', ' ')}</span><time>{shortTime(record.created_at)}</time></div><h3>{record.title}</h3><p>{Object.entries(details).filter(([, value]) => value !== '').slice(0, 4).map(([key, value]) => `${labels[key] || key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ')}</p><small>Logged by {record.staff_name} ({record.staff_initials})</small><StatusActions record={record} saving={saving} manager={manager} perform={perform} /></article>;
      })}</div>
    </div>
  </section>;
}

function StatusActions({ record, saving, manager, perform }: { record: RecordRow; saving: boolean; manager: boolean; perform: (action: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const next: Record<string, string[]> = {
    customer_request: record.status === 'open' ? ['contacted', 'fulfilled', 'cancelled'] : record.status === 'contacted' ? ['fulfilled', 'cancelled'] : [],
    store_need: ({ requested: ['approved', 'cancelled'], approved: ['packed', 'cancelled'], packed: ['sent'], sent: ['received'] } as Record<string, string[]>)[record.status] || [],
    stock_discrepancy: manager ? ({ open: ['stocktake_planned', 'adjusted', 'no_change', 'closed'], stocktake_planned: ['adjusted', 'no_change', 'closed'], adjusted: ['closed'], no_change: ['closed'] } as Record<string, string[]>)[record.status] || [] : [],
    incident: manager ? ['reviewed', 'closed'].filter(status => status !== record.status) : [],
  };
  return next[record.record_type]?.length ? <div className={styles.statusActions}>{next[record.record_type].map(status => <button disabled={saving} key={status} onClick={() => perform('transition_record', { record_id: record.id, status })}>{status.replaceAll('_', ' ')}</button>)}</div> : null;
}

function ManagerTools({ form, setForm, locations, saving, perform }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void; locations: Location[]; saving: boolean; perform: (action: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [tool, setTool] = useState('task');
  return <section className={styles.contentSection}><Title title="Manage Store Daybook" subtitle="Publish content and shape the recurring work for this location." />
    <div className={styles.toolTabs}>{[['task', 'Task'], ['communication', 'Communication'], ['reference', 'Reference'], ['guide', 'Product guide']].map(([id, label]) => <button className={tool === id ? styles.selectedTool : ''} onClick={() => { setTool(id); setForm({}); }} key={id}>{label}</button>)}</div>
    <form className={styles.managerForm} onSubmit={event => { event.preventDefault(); void perform(tool === 'task' ? 'create_task' : tool === 'communication' ? 'create_communication' : tool === 'reference' ? 'save_reference' : 'save_guide', tool === 'communication' ? { ...form, location_ids: form.location_ids ? form.location_ids.split(',').map(Number) : [] } : form); }}>
      {tool === 'task' && <><Field label="Task title" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Instructions" type="textarea" value={form.instructions} onChange={value => setForm({ ...form, instructions: value })} /><div className={styles.formRow}><label className={styles.field}><span>Phase</span><select value={form.phase || 'during_day'} onChange={event => setForm({ ...form, phase: event.target.value })}><option value="opening">Opening</option><option value="during_day">Throughout day</option><option value="closing">Closing</option></select></label><label className={styles.field}><span>Repeats</span><select value={form.recurrence || 'daily'} onChange={event => setForm({ ...form, recurrence: event.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="once">One date</option></select></label></div>{form.recurrence === 'weekly' && <label className={styles.field}><span>Weekday</span><select value={form.weekday || '1'} onChange={event => setForm({ ...form, weekday: event.target.value })}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>}{form.recurrence === 'once' && <Field label="Scheduled date" type="date" value={form.scheduled_date} onChange={value => setForm({ ...form, scheduled_date: value })} />}</>}
      {tool === 'communication' && <><Field label="Headline" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Message" type="textarea" value={form.message} onChange={value => setForm({ ...form, message: value })} /><label className={styles.field}><span>Priority</span><select value={form.priority || 'normal'} onChange={event => setForm({ ...form, priority: event.target.value })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label><div className={styles.locationChecks}>{locations.map(location => <label key={location.id}><input type="checkbox" checked={(form.location_ids || '').split(',').includes(String(location.id))} onChange={event => { const ids = new Set((form.location_ids || '').split(',').filter(Boolean)); event.target.checked ? ids.add(String(location.id)) : ids.delete(String(location.id)); setForm({ ...form, location_ids: [...ids].join(',') }); }} />{location.name}</label>)}</div></>}
      {tool === 'reference' && <><Field label="Category" value={form.category} onChange={value => setForm({ ...form, category: value })} /><Field label="Title" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Information" type="textarea" value={form.content} onChange={value => setForm({ ...form, content: value })} /><Field label="Safe link (optional)" type="url" value={form.link_url} onChange={value => setForm({ ...form, link_url: value })} /></>}
      {tool === 'guide' && <><div className={styles.formRow}><Field label="Product name" value={form.product_name} onChange={value => setForm({ ...form, product_name: value })} /><Field label="SKU" value={form.sku} onChange={value => setForm({ ...form, sku: value })} /></div><div className={styles.formRow}><Field label="Category" value={form.category} onChange={value => setForm({ ...form, category: value })} /><Field label="Shelf" value={form.shelf_location} onChange={value => setForm({ ...form, shelf_location: value })} /><Field label="Box" value={form.box_location} onChange={value => setForm({ ...form, box_location: value })} /></div><Field label="Guidance" type="textarea" value={form.guidance} onChange={value => setForm({ ...form, guidance: value })} /><Field label="Photo URL (optional)" type="url" value={form.image_url} onChange={value => setForm({ ...form, image_url: value })} /></>}
      <button className={styles.primary} disabled={saving}>{saving ? 'Saving…' : `Add ${tool}`}</button>
    </form>
  </section>;
}