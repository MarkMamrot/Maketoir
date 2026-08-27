'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle, BookOpen, Box, Check, ChevronLeft, ClipboardCheck, Clock3,
  ClipboardPlus, ClipboardX, Megaphone, PackageOpen, Pencil, Plus, Search, Settings2, ShoppingBag, Sparkles,
  Trash2, Truck, UserRoundCheck, Users, X,
} from 'lucide-react';
import type { PosSession } from '../../_types';
import { UnifiedHelpDrawer } from '@/components/help/UnifiedHelpDrawer';
import { getDaybookDisplayDates, getDaybookTaskDisplay } from '@/lib/pos/daybookService';
import {
  addDaybookClipboardItem,
  formatDaybookClipboardRecord,
  serializeDaybookClipboard,
  type DaybookClipboardItem,
} from '@/lib/pos/daybookClipboard';
import styles from './PosStoreDaybook.module.css';

type Staff = { id?: number | null; name: string; initials: string };
type TaskPhase = 'opening' | 'during_day' | 'closing';
type Task = { id: number; template_id: number; phase: TaskPhase; title_snapshot: string; instructions_snapshot?: string; instructions?: string; recurrence: string; weekday?: number | null; scheduled_date?: string | null; status: string; can_edit: boolean; last_staff_name?: string; last_staff_initials?: string; signed_at?: string };
type TaskHistory = { id: number; template_id: number; task_date: string; title_snapshot: string; instructions?: string; phase: TaskPhase; recurrence: string; weekday?: number | null; scheduled_date?: string | null; status: string; is_active: number; can_edit: boolean; staff_name?: string; staff_initials?: string; signed_at?: string };
type EditableTask = Pick<Task, 'template_id' | 'title_snapshot' | 'instructions' | 'phase' | 'recurrence' | 'weekday' | 'scheduled_date'>;
type ColourKey = 'pastel_rose' | 'pastel_peach' | 'pastel_mint' | 'pastel_sky' | 'fluoro_yellow' | 'fluoro_lime' | 'fluoro_pink';
type Reader = { name: string; initials: string; read_at: string };
type Editable = { background_color?: ColourKey | null; can_edit: boolean };
type Communication = Editable & { id: number; title: string; message: string; priority: string; is_pinned: number; published_at: string; read_count: number; my_read: number; readers: Reader[] };
type RecordRow = Editable & { id: number; record_type: string; status: string; title: string; occurred_on?: string | null; details_json: Record<string, unknown> | string; created_at: string; staff_name: string; staff_initials: string; destination_location_id?: number | null };
type ReferenceRow = Editable & { id: number; category: string; title: string; content: string; link_url?: string | null };
type GuideRow = Editable & { id: number; variant_id?: string | null; sku?: string | null; product_name: string; category?: string | null; shelf_location?: string | null; box_location?: string | null; guidance?: string | null; image_url?: string | null; image_alt?: string | null; status: string };
type GuideProduct = { variant_id: string; product_id: string; product_name: string; option_label?: string | null; sku?: string | null; image_url?: string | null; image_alt?: string | null };
type Location = { id: number; name: string };
type Workspace = {
  date: string;
  location: Location;
  permissions: { manager: boolean; editPolicy: 'author_only' | 'managers' | 'anyone' };
  tasks: Task[];
  taskDates: string[];
  taskHistory: TaskHistory[];
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

type EditorType = 'task' | 'communication' | 'reference' | 'guide' | 'customer_request' | 'store_need' | 'stock_discrepancy' | 'incident';

const colours: { key: ColourKey; label: string }[] = [
  { key: 'pastel_rose', label: 'Rose' }, { key: 'pastel_peach', label: 'Peach' },
  { key: 'pastel_mint', label: 'Mint' }, { key: 'pastel_sky', label: 'Sky' },
  { key: 'fluoro_yellow', label: 'Highlighter yellow' }, { key: 'fluoro_lime', label: 'Highlighter lime' },
  { key: 'fluoro_pink', label: 'Highlighter pink' },
];

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

function taskDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return { weekday: date.toLocaleDateString([], { weekday: 'long' }), day: date.toLocaleDateString([], { day: 'numeric', month: 'short' }) };
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function taskSchedule(recurrence: string, weekday?: number | null, scheduledDate?: string | null) {
  if (recurrence === 'weekly' && weekday != null) return { key: `weekday-${weekday}`, label: weekdayNames[weekday], order: weekday || 7 };
  if (recurrence === 'once' && scheduledDate) return { key: `date-${scheduledDate}`, label: taskDateLabel(scheduledDate).weekday, order: 8 };
  return { key: 'daily', label: 'Every day', order: 0 };
}

function defaultTaskPhase(tasks: Task[]): TaskPhase {
  const complete = (phase: TaskPhase) => {
    const phaseTasks = tasks.filter(task => task.phase === phase);
    return phaseTasks.length === 0 || phaseTasks.every(task => task.status === 'completed');
  };
  if (!complete('opening')) return 'opening';
  if (!complete('during_day')) return 'during_day';
  return 'closing';
}

export function PosStoreDaybook({ session, onBack, locationOverride, embedded = false }: { session: PosSession; onBack: () => void; locationOverride?: Location; embedded?: boolean }) {
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
  const [editor, setEditor] = useState<EditorType | null>(null);
  const [taskPhase, setTaskPhase] = useState<TaskPhase>('opening');
  const [taskPhaseDate, setTaskPhaseDate] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [clipboardItems, setClipboardItems] = useState<DaybookClipboardItem[]>([]);
  const [clipboardMessage, setClipboardMessage] = useState('');

  const location = locationOverride ?? { id: session.location_id, name: session.location_name };
  const locationParam = locationOverride ? `&location_id=${location.id}` : '';
  const identityKey = `pos_daybook_staff_${location.id}_${date}`;
  const clipboardKey = `pos_daybook_clipboard_${location.id}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(identityKey);
      setStaff(saved ? JSON.parse(saved) : null);
      setIdentityOpen(!saved);
    } catch { setStaff(null); setIdentityOpen(true); }
  }, [identityKey]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(clipboardKey) ?? '[]');
      setClipboardItems(Array.isArray(saved) ? saved : []);
    } catch { setClipboardItems([]); }
    setClipboardMessage('');
  }, [clipboardKey]);

  async function load(selectedStaff = staff) {
    setLoading(true);
    setError('');
    try {
      const initials = selectedStaff?.initials ? `&initials=${encodeURIComponent(selectedStaff.initials)}` : '';
      const response = await fetch(`/api/pos/daybook?date=${date}${initials}${locationParam}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Daybook could not be loaded.');
      setWorkspace(result);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Daybook could not be loaded.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (workspace && workspace.date !== taskPhaseDate) {
      setTaskPhase(defaultTaskPhase(workspace.tasks));
      setTaskPhaseDate(workspace.date);
    }
  }, [workspace, taskPhaseDate]);

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
          ...(locationOverride ? { location_id: location.id } : {}),
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
    try { await post(action, payload); setForm({}); setEditor(null); await load(); } catch {}
  }

  async function writeDaybookClipboard(items: DaybookClipboardItem[]) {
    const text = serializeDaybookClipboard(items);
    try { localStorage.setItem(clipboardKey, JSON.stringify(items)); } catch {}
    setClipboardItems(items);
    if (!navigator.clipboard) return false;
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  async function addRecordToClipboard(record: RecordRow) {
    const item = formatDaybookClipboardRecord({
      id: record.id,
      recordType: record.record_type as 'customer_request' | 'store_need',
      title: record.title,
      details: detailsOf(record),
    });
    const next = addDaybookClipboardItem(clipboardItems, item);
    const copied = await writeDaybookClipboard(next);
    setClipboardMessage(copied
      ? `${record.title} added. ${next.length} ${next.length === 1 ? 'item' : 'items'} ready to paste.`
      : `${record.title} was added to the saved list, but browser clipboard access was blocked. Add it again before pasting or copy the visible text manually.`);
  }

  async function clearDaybookClipboard() {
    try { localStorage.removeItem(clipboardKey); } catch {}
    setClipboardItems([]);
    if (!navigator.clipboard) { setClipboardMessage('Saved list cleared. Browser clipboard access is unavailable.'); return; }
    try { await navigator.clipboard.writeText(''); setClipboardMessage('Clipboard cleared.'); }
    catch { setClipboardMessage('Saved list cleared, but browser clipboard access was blocked.'); }
  }

  function openEditor(type: EditorType, values: Record<string, unknown> = {}) {
    setForm(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value == null ? '' : String(value)])));
    setEditor(type);
  }

  async function signChecklistTask(task: Task) {
    const reopening = task.status === 'completed';
    await perform('sign_task', { instance_id: task.id, signoff_action: reopening ? 'reopened' : 'completed', reason: reopening ? 'Manager reopened from Daybook' : '' });
    if (reopening) return;
    const remaining = workspace?.tasks.filter(item => item.phase === task.phase && item.id !== task.id && item.status !== 'completed') ?? [];
    if (remaining.length === 0) {
      if (task.phase === 'opening') setTaskPhase('during_day');
      if (task.phase === 'during_day') setTaskPhase('closing');
    }
  }

  const records = workspace?.records.filter(record => record.record_type === active) ?? [];
  const completed = workspace?.tasks.filter(task => task.status === 'completed').length ?? 0;
  const total = workspace?.tasks.length ?? 0;
  const unread = workspace?.communications.filter(item => !Number(item.my_read)).length ?? 0;

  return (
    <div className={`${styles.shell} ${embedded ? styles.embeddedShell : ''}`}>
      <header className={styles.header}>
        <button className={styles.iconButton} onClick={onBack} aria-label={embedded ? 'Back to location daybooks' : 'Back to POS'}><ChevronLeft /></button>
        <div className={styles.brand}>
          <span className={styles.brandMark}><Sparkles size={19} /></span>
          <div><h1>Store Daybook</h1><p>{location.name} · one place for today</p></div>
        </div>
        <div className={styles.headerTools}>
          <input type="date" value={date} onChange={event => setDate(event.target.value)} aria-label="Daybook date" />
          <button className={styles.identityButton} onClick={() => setIdentityOpen(true)}>
            <UserRoundCheck size={17} /> {staff ? `${staff.name} (${staff.initials})` : 'Choose staff'}
          </button>
          <button className={styles.iconButton} onClick={() => setHelpOpen(true)} aria-label="Open Store Daybook help"><BookOpen size={18} /></button>
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
          <button className={active === 'settings' ? styles.activeTab : ''} onClick={() => setActive('settings')}><Settings2 size={17} /><span>Settings</span></button>
        )}
      </nav>

      <main className={styles.main}>
        {error && <div className={styles.error} role="alert">{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
        {loading && <div className={styles.loading}>Opening the Daybook…</div>}

        {!loading && active === 'today' && (
          <ChecklistView
            workspace={workspace}
            phase={taskPhase}
            onPhaseChange={setTaskPhase}
            saving={saving}
            onSign={signChecklistTask}
            onEdit={task => openEditor('task', { _id: task.template_id, title: task.title_snapshot, instructions: task.instructions, phase: task.phase, recurrence: task.recurrence, weekday: task.weekday, scheduled_date: task.scheduled_date })}
            onDelete={async task => {
              if (!confirm(`Delete "${task.title_snapshot}" from the active Daybook? Future occurrences will stop, while existing sign-off history will be retained.`)) return;
              await perform('delete_item', { item_type: 'task', item_id: task.template_id });
            }}
            onAdd={workspace?.permissions.manager ? () => openEditor('task', { phase: taskPhase }) : undefined}
          />
        )}

        {!loading && active === 'communications' && (
          <section className={styles.contentSection}>
            <Title title="Store communications" subtitle="Latest first. Acknowledgments are visible to the whole store." action={workspace?.permissions.manager ? <button className={styles.addButton} onClick={() => openEditor('communication', { location_ids: workspace.location.id })}><Plus size={17} /> Add new</button> : undefined} />
            <div className={styles.feed}>{workspace?.communications.map(item => <article className={`${styles.notice} ${item.priority !== 'normal' ? styles.noticeImportant : ''} ${item.background_color ? styles[item.background_color] : ''}`} key={item.id}>
              <div className={styles.noticeMeta}><span>{item.priority}</span><time>{shortTime(item.published_at)}</time></div>
              <div className={styles.cardHeading}><h3>{item.title}</h3>{item.can_edit && <button className={styles.editButton} onClick={() => openEditor('communication', { _id: item.id, title: item.title, message: item.message, priority: item.priority, background_color: item.background_color })} aria-label={`Edit ${item.title}`}><Pencil size={16} /></button>}</div><p>{item.message}</p>
              <div className={styles.readers}><Users size={15} />{item.readers.length ? item.readers.map(reader => <span key={reader.initials} title={`${reader.name} · ${shortTime(reader.read_at)}`}><b>{reader.initials}</b>{reader.name}</span>) : <small>No acknowledgments yet</small>}</div>
              <footer><small>{item.read_count} acknowledgment{Number(item.read_count) === 1 ? '' : 's'}</small><button disabled={saving || Boolean(Number(item.my_read))} onClick={() => perform('read_communication', { communication_id: item.id })}>{Number(item.my_read) ? <><Check size={16} /> Read</> : 'Mark as read'}</button></footer>
            </article>)}</div>
          </section>
        )}

        {!loading && ['customer_request', 'store_need', 'stock_discrepancy', 'incident'].includes(active) && (
          <RecordSection
            type={active}
            records={records}
            saving={saving}
            perform={perform}
            manager={Boolean(workspace?.permissions.manager)}
            onAdd={() => openEditor(active as EditorType)}
            onEdit={record => openEditor(active as EditorType, { _id: record.id, occurred_on: record.occurred_on, background_color: record.background_color, ...detailsOf(record) })}
            onDelete={async record => {
              if (!confirm(`Delete "${record.title}" from the active Daybook? Its audit history will be retained.`)) return;
              await perform('delete_item', { item_type: 'record', item_id: record.id });
            }}
            onAddToClipboard={addRecordToClipboard}
            clipboardItems={clipboardItems}
            clipboardMessage={clipboardMessage}
            onClearClipboard={clearDaybookClipboard}
          />
        )}

        {!loading && active === 'references' && (
          <section className={styles.contentSection}>
            <Title title="Reference desk" subtitle="Contacts, guides and troubleshooting without hunting through old tabs." action={workspace?.permissions.manager ? <button className={styles.addButton} onClick={() => openEditor('reference')}><Plus size={17} /> Add new</button> : undefined} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search references" />
            <div className={styles.referenceGrid}>{workspace?.references.filter(item => `${item.title} ${item.content} ${item.category}`.toLowerCase().includes(query.toLowerCase())).map(item => <article className={`${styles.reference} ${item.background_color ? styles[item.background_color] : ''}`} key={item.id}><span>{item.category}</span><div className={styles.cardHeading}><h3>{item.title}</h3>{item.can_edit && <button className={styles.editButton} onClick={() => openEditor('reference', { _id: item.id, category: item.category, title: item.title, content: item.content, link_url: item.link_url, background_color: item.background_color })} aria-label={`Edit ${item.title}`}><Pencil size={16} /></button>}</div><p>{item.content}</p>{item.link_url && <a href={item.link_url} target="_blank" rel="noreferrer">Open resource</a>}</article>)}</div>
          </section>
        )}

        {!loading && active === 'guides' && (
          <section className={styles.contentSection}>
            <Title title="Product guide" subtitle="Find products, display positions and storage boxes at a glance." action={workspace?.permissions.manager ? <button className={styles.addButton} onClick={() => openEditor('guide')}><Plus size={17} /> Add new</button> : undefined} />
            <SearchBox value={query} onChange={setQuery} placeholder="Search product, SKU, shelf or box" />
            <div className={styles.guideGrid}>{workspace?.guides.filter(item => `${item.product_name} ${item.sku} ${item.category} ${item.shelf_location} ${item.box_location}`.toLowerCase().includes(query.toLowerCase())).map(item => <article className={`${styles.guide} ${item.background_color ? styles[item.background_color] : ''}`} key={item.id}>
              <div className={styles.guideImage}>{item.image_url ? <img src={item.image_url} alt={item.image_alt || item.product_name} /> : <><PackageOpen size={28} /><span>Photo coming soon</span></>}</div>
              <div><span>{item.category || 'Product'}{item.sku ? ` · ${item.sku}` : ''}</span><div className={styles.cardHeading}><h3>{item.product_name}</h3>{item.can_edit && <button className={styles.editButton} onClick={() => openEditor('guide', { _id: item.id, variant_id: item.variant_id, product_name: item.product_name, sku: item.sku, category: item.category, shelf_location: item.shelf_location, box_location: item.box_location, guidance: item.guidance, image_url: item.image_url, image_alt: item.image_alt, background_color: item.background_color })} aria-label={`Edit ${item.product_name}`}><Pencil size={16} /></button>}</div><dl><dt>Shelf</dt><dd>{item.shelf_location || 'To be mapped'}</dd><dt>Box</dt><dd>{item.box_location || 'To be mapped'}</dd></dl>{item.guidance && <p>{item.guidance}</p>}</div>
            </article>)}</div>
          </section>
        )}

        {!loading && active === 'settings' && workspace?.permissions.manager && <DaybookSettings policy={workspace.permissions.editPolicy} saving={saving} perform={perform} />}
      </main>

      {editor && workspace && <div className={styles.modalBackdrop} role="presentation"><div className={styles.editorModal} role="dialog" aria-modal="true" aria-labelledby="editor-title">
        <button className={styles.modalClose} onClick={() => { setEditor(null); setForm({}); }} aria-label="Close"><X /></button>
        <EditorForm type={editor} form={form} setForm={setForm} locations={workspace.locations} saving={saving} perform={perform} />
      </div></div>}

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
      <UnifiedHelpDrawer open={helpOpen} onOpenChange={setHelpOpen} audience="pos" product="pos" currentContext="daybook" chatEndpoint="/api/pos/assistant/chat" escalationEndpoint="/api/pos/assistant/escalate" showFloatingTrigger={false} />
    </div>
  );
}

function ChecklistView({ workspace, phase, onPhaseChange, saving, onSign, onEdit, onDelete, onAdd }: {
  workspace: Workspace | null;
  phase: TaskPhase;
  onPhaseChange: (phase: TaskPhase) => void;
  saving: boolean;
  onSign: (task: Task) => Promise<void>;
  onEdit: (task: EditableTask) => void;
  onDelete: (task: EditableTask) => Promise<void>;
  onAdd?: () => void;
}) {
  if (!workspace) return null;
  const phaseMeta: { id: TaskPhase; short: string; title: string }[] = [
    { id: 'opening', short: 'OPEN', title: 'Open the store' },
    { id: 'during_day', short: 'TODAY', title: 'Keep the day moving' },
    { id: 'closing', short: 'CLOSE', title: 'Close with confidence' },
  ];
  const currentTasks = workspace.tasks.filter(task => task.phase === phase);
  const phaseHistory = workspace.taskHistory.filter(item => item.phase === phase);
  const rows = new Map<number, { templateId: number; title: string; instructions?: string; recurrence: string; weekday?: number | null; scheduledDate?: string | null; editableTask?: EditableTask }>();
  for (const item of phaseHistory) rows.set(item.template_id, { templateId: item.template_id, title: item.title_snapshot, instructions: item.instructions, recurrence: item.recurrence, weekday: item.weekday, scheduledDate: item.scheduled_date, editableTask: item.can_edit ? item : undefined });
  for (const task of currentTasks) rows.set(task.template_id, { templateId: task.template_id, title: task.title_snapshot, instructions: task.instructions, recurrence: task.recurrence, weekday: task.weekday, scheduledDate: task.scheduled_date, editableTask: task.can_edit ? task : undefined });
  const scheduleGroups = new Map<string, { label: string; order: number; rows: typeof rows extends Map<number, infer Row> ? Row[] : never }>();
  for (const row of rows.values()) {
    const schedule = taskSchedule(row.recurrence, row.weekday, row.scheduledDate);
    const group = scheduleGroups.get(schedule.key) ?? { label: schedule.label, order: schedule.order, rows: [] };
    group.rows.push(row);
    scheduleGroups.set(schedule.key, group);
  }
  const groupedRows = [...scheduleGroups.entries()].sort(([, left], [, right]) => left.order - right.order);
  const displayDates = getDaybookDisplayDates(workspace.taskDates);
  const completed = currentTasks.filter(task => task.status === 'completed').length;
  const selected = phaseMeta.find(item => item.id === phase) ?? phaseMeta[0];

  return <section className={styles.checklistSection}>
    <Title title="Today's checklist" subtitle="Tasks are grouped by when they are scheduled, with seven days of compact sign-off history." action={onAdd ? <button className={styles.addButton} onClick={onAdd}><Plus size={17} /> Add new task</button> : undefined} />
    <div className={styles.phaseSelector} role="tablist" aria-label="Checklist phase">
      {phaseMeta.map(item => {
        const tasks = workspace.tasks.filter(task => task.phase === item.id);
        const done = tasks.filter(task => task.status === 'completed').length;
        return <button role="tab" aria-selected={phase === item.id} className={phase === item.id ? styles.activePhase : ''} onClick={() => onPhaseChange(item.id)} key={item.id}>
          <span className={styles.phaseBadge}>{item.short}</span><span className={styles.phaseCopy}><strong>{item.title}</strong><small>{done}/{tasks.length} today</small></span>
        </button>;
      })}
    </div>
    <div className={styles.checklistHeading}><div><span>{selected.short}</span><h2>{selected.title}</h2></div><b>{completed}/{currentTasks.length} complete today</b></div>
    <div className={styles.checklistScroll} tabIndex={0} aria-label={`${selected.title} seven-day sign-off history`}>
      <table className={styles.checklistTable}>
        <colgroup><col className={styles.taskColumn} />{displayDates.map(taskDate => <col className={styles.signoffColumn} key={taskDate} />)}</colgroup>
        <thead><tr><th scope="col">Task</th>{displayDates.map(taskDate => {
          const label = taskDateLabel(taskDate);
          return <th scope="col" className={taskDate === workspace.date ? styles.currentDate : ''} key={taskDate}><span>{label.weekday.slice(0, 3)}</span><strong>{label.day}</strong>{taskDate === workspace.date && <small>Today</small>}</th>;
        })}</tr></thead>
        {groupedRows.map(([groupKey, group]) => <tbody className={`${styles.scheduleGroup} ${styles[`scheduleTone${group.order <= 7 ? group.order : 0}`]}`} key={groupKey}>
          <tr className={styles.scheduleHeading}><th colSpan={workspace.taskDates.length + 1} scope="rowgroup"><span>{group.label}</span><small>{group.rows.length} {group.rows.length === 1 ? 'task' : 'tasks'}</small></th></tr>
          {group.rows.map(row => {
          const currentTask = currentTasks.find(task => task.template_id === row.templateId);
          const display = getDaybookTaskDisplay(row.title, currentTask?.instructions_snapshot ?? row.instructions);
          return <tr key={row.templateId}><th scope="row"><div><strong>{display.title}</strong>{display.instructions && <small>{display.instructions}</small>}</div>{row.editableTask && <div className={styles.taskRowActions}><button type="button" onClick={() => onEdit(row.editableTask!)} title={`Edit ${row.title}`} aria-label={`Edit ${row.title}`}><Pencil size={15} /></button><button type="button" className={styles.taskDeleteAction} onClick={() => void onDelete(row.editableTask!)} disabled={saving} title={`Delete ${row.title}`} aria-label={`Delete ${row.title}`}><Trash2 size={15} /></button></div>}</th>{displayDates.map(taskDate => {
            const entry = phaseHistory.find(item => item.template_id === row.templateId && item.task_date === taskDate);
            const isCurrent = taskDate === workspace.date;
            if (!entry) return <td className={styles.notScheduled} key={taskDate}><span aria-label="Not scheduled">—</span></td>;
            if (isCurrent && currentTask) return <td className={`${styles.currentDate} ${entry.status === 'completed' ? styles.signedCell : styles.openCell}`} key={taskDate}><button disabled={saving || (entry.status === 'completed' && !workspace.permissions.manager)} onClick={() => void onSign(currentTask)} title={entry.status === 'completed' ? `Signed by ${entry.staff_name || 'staff'}${workspace.permissions.manager ? '. Select to reopen.' : ''}` : 'Select to sign off'}>{entry.status === 'completed' ? <><Check size={17} /><b>{entry.staff_initials}</b><small>{entry.staff_name}</small></> : <><span className={styles.openMarker} />Sign off</>}</button></td>;
            return <td className={entry.status === 'completed' ? styles.signedCell : styles.missedCell} key={taskDate}>{entry.status === 'completed' ? <div title={`Signed by ${entry.staff_name || 'staff'} · ${shortTime(entry.signed_at)}`}><Check size={16} /><b>{entry.staff_initials}</b><small>{entry.staff_name}</small></div> : <div title="Not signed"><span className={styles.missedMarker} /><small>Not signed</small></div>}</td>;
          })}</tr>;
        })}</tbody>)}
      </table>
      {rows.size === 0 && <p className={styles.empty}>No tasks were scheduled in this section during the last seven days.</p>}
    </div>
    <div className={styles.checklistLegend}><span><i className={styles.legendSigned}><Check size={12} /></i> Signed</span><span><i className={styles.legendMissed} /> Not signed</span><span><i className={styles.legendBlank}>—</i> Not scheduled</span></div>
  </section>;
}

function Title({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) { return <div className={styles.title}><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>; }
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className={styles.search}><Search size={17} /><input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} /></label>; }

function Field({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value?: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return <label className={styles.field}><span>{label}</span>{type === 'textarea' ? <textarea value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} /> : <input type={type} value={value || ''} onChange={event => onChange(event.target.value)} placeholder={placeholder} />}</label>;
}

function RecordSection({ type, records, saving, perform, manager, onAdd, onEdit, onDelete, onAddToClipboard, clipboardItems, clipboardMessage, onClearClipboard }: {
  type: string;
  records: RecordRow[];
  saving: boolean;
  perform: (action: string, payload?: Record<string, unknown>) => Promise<void>;
  manager: boolean;
  onAdd: () => void;
  onEdit: (record: RecordRow) => void;
  onDelete: (record: RecordRow) => Promise<void>;
  onAddToClipboard: (record: RecordRow) => void;
  clipboardItems: DaybookClipboardItem[];
  clipboardMessage: string;
  onClearClipboard: () => void;
}) {
  const meta: Record<string, [string, string]> = {
    customer_request: ['Customer requests', 'Record sold-out products and follow up without losing the customer thread.'],
    store_need: ['Store needs', 'Ask the warehouse for consumables or stock, then follow it through dispatch.'],
    stock_discrepancy: ['Stock discrepancies', 'Capture what the system says and what you found for a manager stocktake.'],
    incident: ['Incident reports', 'Record the facts carefully and sign the report before submitting it.'],
  };
  const labels: Record<string, string> = { customer_name: 'Customer name', contact_details: 'Contact details', item: 'Item', notes: 'Notes', quantity: 'Quantity', unit: 'Unit', store_notes: 'Store notes', sku: 'SKU / code', size: 'Size', system_quantity: 'System quantity', physical_quantity: 'Physical quantity found', time: 'Time', staff_present: 'Staff present', event_description: 'Event description', loss_or_damage: 'Loss or damage', emergency_services: 'Emergency services called?', instigator_description: 'Description of incident instigator', management_notified: 'Has management been told?' };
  const usesClipboard = type === 'customer_request' || type === 'store_need';
  return <section className={styles.contentSection}>
    <Title title={meta[type][0]} subtitle={meta[type][1]} action={<div className={styles.titleActions}>
      {usesClipboard && <button type="button" className={styles.clearClipboardButton} onClick={() => void onClearClipboard()} disabled={clipboardItems.length === 0}><ClipboardX size={16} /> Clear clipboard</button>}
      <button className={styles.addButton} onClick={onAdd}><Plus size={17} /> Add new</button>
    </div>} />
      <div className={styles.recordList}>{records.length === 0 && <p className={styles.empty}>Nothing recorded here yet.</p>}{records.map(record => {
        const details = detailsOf(record);
        return <article className={`${styles.record} ${record.background_color ? styles[record.background_color] : ''}`} key={record.id}>
          <div className={styles.recordTop}><span>{record.status.replaceAll('_', ' ')}</span><time>{shortTime(record.created_at)}</time></div>
          <div className={styles.cardHeading}><h3>{record.title}</h3></div>
          <p>{Object.entries(details).filter(([, value]) => value !== '').slice(0, 4).map(([key, value]) => `${labels[key] || key.replaceAll('_', ' ')}: ${String(value)}`).join(' · ')}</p>
          <small>Logged by {record.staff_name} ({record.staff_initials})</small>
          <div className={styles.recordFooter}>
            <StatusActions record={record} saving={saving} manager={manager} perform={perform} />
            {usesClipboard && <div className={styles.recordCardActions}>
              {record.can_edit && <button type="button" onClick={() => onEdit(record)} title={`Edit ${record.title}`}><Pencil size={15} /> Edit</button>}
              {record.can_edit && <button type="button" className={styles.recordDeleteAction} onClick={() => void onDelete(record)} disabled={saving} title={`Delete ${record.title}`}><Trash2 size={15} /> Delete</button>}
              <button type="button" onClick={() => void onAddToClipboard(record)} title={`Add ${record.title} to clipboard`}><ClipboardPlus size={15} /> Add to clipboard</button>
            </div>}
          </div>
        </article>;
      })}</div>
      {usesClipboard && <aside className={styles.daybookClipboard} aria-live="polite">
        <div><ClipboardCheck size={18} /><span><strong>Transfer notes clipboard</strong><small>{clipboardItems.length ? `${clipboardItems.length} ${clipboardItems.length === 1 ? 'item' : 'items'} ready to paste into branch transfer notes.` : 'Add cards above to build transfer notes.'}</small></span></div>
        {clipboardMessage && <p>{clipboardMessage}</p>}
        {clipboardItems.length > 0 && <pre>{serializeDaybookClipboard(clipboardItems)}</pre>}
        <button type="button" onClick={() => void onClearClipboard()} disabled={clipboardItems.length === 0}><ClipboardX size={16} /> Clear clipboard</button>
      </aside>}
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

function EditorForm({ type, form, setForm, locations, saving, perform }: { type: EditorType; form: Record<string, string>; setForm: (form: Record<string, string>) => void; locations: Location[]; saving: boolean; perform: (action: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const recordFields: Record<string, string[]> = {
    customer_request: ['customer_name', 'contact_details', 'item', 'notes'], store_need: ['item', 'quantity', 'unit', 'store_notes'],
    stock_discrepancy: ['sku', 'item', 'size', 'system_quantity', 'physical_quantity', 'notes'],
    incident: ['time', 'staff_present', 'event_description', 'loss_or_damage', 'emergency_services', 'instigator_description', 'management_notified'],
  };
  const labels: Record<string, string> = { customer_name: 'Customer name', contact_details: 'Contact details', item: 'Item', notes: 'Notes', quantity: 'Quantity', unit: 'Unit', store_notes: 'Store notes', sku: 'SKU / code', size: 'Size', system_quantity: 'System quantity', physical_quantity: 'Physical quantity found', time: 'Time', staff_present: 'Staff present', event_description: 'Event description', loss_or_damage: 'Loss or damage', emergency_services: 'Emergency services called?', instigator_description: 'Description of incident instigator', management_notified: 'Has management been told?' };
  const isRecord = Boolean(recordFields[type]);
  const editing = Boolean(form._id);
  const heading = { task: 'task', communication: 'communication', reference: 'reference', guide: 'product guide', customer_request: 'customer request', store_need: 'store need', stock_discrepancy: 'stock discrepancy', incident: 'incident report' }[type];
  async function submit() {
    if (isRecord) {
      const details = Object.fromEntries(recordFields[type].map(key => [key, form[key] || '']));
      const title = type === 'incident' ? 'Incident report' : form.item || form.customer_name || '';
      await perform(editing ? 'update_record' : 'create_record', { record_id: form._id, record_type: type, title, occurred_on: form.occurred_on || todayLocal(), destination_location_id: form.destination_location_id || null, background_color: form.background_color || null, details });
      return;
    }
    const action = type === 'task' ? (editing ? 'update_task' : 'create_task') : type === 'communication' ? (editing ? 'update_communication' : 'create_communication') : type === 'reference' ? (editing ? 'update_reference' : 'save_reference') : editing ? 'update_guide' : 'save_guide';
    const ids = { template_id: form._id, communication_id: form._id, reference_id: form._id, guide_id: form._id };
    await perform(action, { ...form, ...ids, background_color: form.background_color || null, location_ids: form.location_ids ? form.location_ids.split(',').map(Number) : [] });
  }
  async function deleteItem() {
    const itemType = type === 'task' || type === 'communication' || type === 'reference' || type === 'guide' ? type : 'record';
    await perform('delete_item', { item_type: itemType, item_id: Number(form._id) });
  }
  return <><h2 id="editor-title">{editing ? 'Edit' : 'Add new'} {heading}</h2><form className={styles.managerForm} onSubmit={event => { event.preventDefault(); void submit(); }}>
    {isRecord && <><Field label={type === 'incident' ? 'Day and date' : 'Date'} type="date" value={form.occurred_on || todayLocal()} onChange={value => setForm({ ...form, occurred_on: value })} />{recordFields[type].map(key => <Field key={key} label={labels[key]} type={['notes', 'store_notes', 'event_description', 'instigator_description'].includes(key) ? 'textarea' : ['system_quantity', 'physical_quantity', 'quantity'].includes(key) ? 'number' : 'text'} value={form[key]} onChange={value => setForm({ ...form, [key]: value })} />)}{type === 'store_need' && !editing && <label className={styles.field}><span>Send to</span><select value={form.destination_location_id || ''} onChange={event => setForm({ ...form, destination_location_id: event.target.value })}><option value="">Select warehouse</option>{locations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>}{type === 'incident' && <div className={styles.privacyNote}>Incident details are restricted to managers after submission. Include only necessary personal information.</div>}</>}
    {type === 'task' && <><Field label="Task title" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Instructions" type="textarea" value={form.instructions} onChange={value => setForm({ ...form, instructions: value })} /><div className={styles.formRow}><label className={styles.field}><span>Phase</span><select value={form.phase || 'during_day'} onChange={event => setForm({ ...form, phase: event.target.value })}><option value="opening">Opening</option><option value="during_day">Throughout day</option><option value="closing">Closing</option></select></label><label className={styles.field}><span>Repeats</span><select value={form.recurrence || 'daily'} onChange={event => setForm({ ...form, recurrence: event.target.value })}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="once">One date</option></select></label></div>{form.recurrence === 'weekly' && <label className={styles.field}><span>Weekday</span><select value={form.weekday || '1'} onChange={event => setForm({ ...form, weekday: event.target.value })}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day, index) => <option value={index} key={day}>{day}</option>)}</select></label>}{form.recurrence === 'once' && <Field label="Scheduled date" type="date" value={form.scheduled_date} onChange={value => setForm({ ...form, scheduled_date: value })} />}</>}
    {type === 'communication' && <><Field label="Headline" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Message" type="textarea" value={form.message} onChange={value => setForm({ ...form, message: value })} /><label className={styles.field}><span>Priority</span><select value={form.priority || 'normal'} onChange={event => setForm({ ...form, priority: event.target.value })}><option value="normal">Normal</option><option value="important">Important</option><option value="urgent">Urgent</option></select></label>{!editing && <div className={styles.locationChecks}>{locations.map(location => <label key={location.id}><input type="checkbox" checked={(form.location_ids || '').split(',').includes(String(location.id))} onChange={event => { const ids = new Set((form.location_ids || '').split(',').filter(Boolean)); event.target.checked ? ids.add(String(location.id)) : ids.delete(String(location.id)); setForm({ ...form, location_ids: [...ids].join(',') }); }} />{location.name}</label>)}</div>}</>}
    {type === 'reference' && <><Field label="Category" value={form.category} onChange={value => setForm({ ...form, category: value })} /><Field label="Title" value={form.title} onChange={value => setForm({ ...form, title: value })} /><Field label="Information" type="textarea" value={form.content} onChange={value => setForm({ ...form, content: value })} /><Field label="Safe link (optional)" type="url" value={form.link_url} onChange={value => setForm({ ...form, link_url: value })} /></>}
    {type === 'guide' && <><GuideProductPicker form={form} setForm={setForm} /><div className={styles.formRow}><Field label="Category" value={form.category} onChange={value => setForm({ ...form, category: value })} /><Field label="Shelf" value={form.shelf_location} onChange={value => setForm({ ...form, shelf_location: value })} /><Field label="Box" value={form.box_location} onChange={value => setForm({ ...form, box_location: value })} /></div><Field label="Guidance" type="textarea" value={form.guidance} onChange={value => setForm({ ...form, guidance: value })} /></>}
    {type !== 'task' && <ColourPicker value={form.background_color} onChange={value => setForm({ ...form, background_color: value })} />}
    {editing && confirmDelete && <div className={styles.deleteConfirmation} role="alert"><div><strong>Delete this {heading}?</strong><span>It will leave the active Daybook. Existing audit history is retained.</span></div><button type="button" onClick={() => setConfirmDelete(false)} disabled={saving}>Cancel</button><button type="button" className={styles.confirmDeleteButton} onClick={() => void deleteItem()} disabled={saving}>{saving ? 'Deleting…' : 'Delete item'}</button></div>}
    <div className={styles.editorActions}>{editing && <button type="button" className={styles.deleteButton} onClick={() => setConfirmDelete(true)} disabled={saving || confirmDelete}><Trash2 size={17} /> Delete</button>}<button className={styles.primary} disabled={saving || confirmDelete || (type === 'guide' && !form.variant_id)}>{saving ? 'Saving…' : editing ? 'Save changes' : `Add ${heading}`}</button></div>
  </form></>;
}

function GuideProductPicker({ form, setForm }: { form: Record<string, string>; setForm: (form: Record<string, string>) => void }) {
  const [search, setSearch] = useState(form.product_name || '');
  const [products, setProducts] = useState<GuideProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/pos/daybook?view=products&q=${encodeURIComponent(search.trim())}`, { cache: 'no-store', signal: controller.signal });
        const result = await response.json();
        if (response.ok) setProducts(result.products ?? []);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === 'AbortError')) setProducts([]);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  function choose(product: GuideProduct) {
    const displayName = `${product.product_name}${product.option_label ? ` - ${product.option_label}` : ''}`;
    setSearch(displayName);
    setForm({ ...form, variant_id: product.variant_id, product_name: displayName, sku: product.sku || '', image_url: product.image_url || '', image_alt: product.image_alt || displayName });
  }

  return <div className={styles.productPicker}><label className={styles.field}><span>Product</span><div className={styles.productSearch}><Search size={17} /><input value={search} onChange={event => { setSearch(event.target.value); setForm({ ...form, variant_id: '' }); }} placeholder="Search product name, SKU or barcode" /></div></label>
    {form.variant_id ? <div className={styles.selectedProduct}>{form.image_url ? <img src={form.image_url} alt={form.image_alt || form.product_name} /> : <div className={styles.productPlaceholder}><PackageOpen size={24} /></div>}<div><strong>{form.product_name}</strong><span>{form.sku || 'No SKU'}</span></div><Check size={18} /></div> : <div className={styles.productResults}>{loading && <small>Searching products…</small>}{!loading && products.map(product => <button type="button" onClick={() => choose(product)} key={product.variant_id}>{product.image_url ? <img src={product.image_url} alt="" /> : <span className={styles.productPlaceholder}><PackageOpen size={18} /></span>}<span><b>{product.product_name}{product.option_label ? ` - ${product.option_label}` : ''}</b><small>{product.sku || 'No SKU'}</small></span></button>)}{!loading && products.length === 0 && <small>No matching active products.</small>}</div>}
  </div>;
}

function DaybookSettings({ policy, saving, perform }: { policy: Workspace['permissions']['editPolicy']; saving: boolean; perform: (action: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const [value, setValue] = useState(policy);
  useEffect(() => setValue(policy), [policy]);
  return <section className={styles.contentSection}><Title title="Daybook settings" subtitle="Choose who can revise existing Daybook content across all stores." /><div className={styles.settingsPanel}><h3>Who can edit existing items?</h3><div className={styles.policyOptions}>{[
    ['author_only', 'Original author only', 'The creating account or staff identity. Managers can maintain imported items with no recorded author.'],
    ['managers', 'Managers only', 'Managers can edit all items, including imported content.'],
    ['anyone', 'Any staff member', 'Anyone with Daybook access can edit existing items.'],
  ].map(([id, label, description]) => <label className={value === id ? styles.selectedPolicy : ''} key={id}><input type="radio" name="edit-policy" value={id} checked={value === id} onChange={() => setValue(id as Workspace['permissions']['editPolicy'])} /><span><b>{label}</b><small>{description}</small></span></label>)}</div><button className={styles.primary} disabled={saving || value === policy} onClick={() => perform('save_settings', { edit_policy: value })}>Save settings</button></div></section>;
}

function ColourPicker({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  return <fieldset className={styles.colourPicker}><legend>Card colour</legend><button type="button" className={!value ? styles.selectedSwatch : ''} onClick={() => onChange('')}><i className={styles.noColour} />Default</button>{colours.map(colour => <button type="button" className={value === colour.key ? styles.selectedSwatch : ''} onClick={() => onChange(colour.key)} key={colour.key}><i className={styles[colour.key]} />{colour.label}</button>)}</fieldset>;
}