'use client';

import { Check, Pencil, X } from 'lucide-react';
import React, { useMemo, useRef, useState } from 'react';

import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';
import { ContactCrmTaskEditor, type ContactCrmTaskEditPayload } from './ContactCrmTaskEditor';

export type ContactCrmWorkspaceTask = {
  id: number;
  contact_id: number;
  contact_name: string;
  contact_company?: string | null;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: 'low' | 'normal' | 'high';
  status: 'open';
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
};

const inputStyle: React.CSSProperties = {
  minHeight: 36,
  border: '1px solid var(--sv-etch)',
  borderRadius: 6,
  background: 'var(--sv-bg-0)',
  color: 'var(--sv-text-main)',
  padding: '7px 10px',
  fontSize: 13,
};

function localDate() {
  return new Date().toLocaleDateString('sv-SE');
}

function dateValue(value: string | null | undefined) {
  return value ? String(value).slice(0, 10) : null;
}

function dueBucket(value: string | null | undefined) {
  const due = dateValue(value);
  if (!due) return 'none';
  const today = localDate();
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return 'upcoming';
}

function dueLabel(value: string | null | undefined) {
  const due = dateValue(value);
  const bucket = dueBucket(value);
  if (!due) return { label: 'No due date', bucket };
  const formatted = new Date(`${due}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  return {
    bucket,
    label: bucket === 'overdue' ? `Overdue · ${formatted}` : bucket === 'today' ? 'Due today' : formatted,
  };
}

export function ContactCrmTaskQueue({
  tasks,
  truncated = false,
  assignees,
  isAdvisor,
  onOpenProfile,
  onTaskChanged,
}: {
  tasks: ContactCrmWorkspaceTask[];
  truncated?: boolean;
  assignees: Array<{ id: number; name: string }>;
  isAdvisor: boolean;
  onOpenProfile: (id: number) => void;
  onTaskChanged: () => Promise<void> | void;
}) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  useTableArrowScroll(bodyScrollRef);
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [workingTaskId, setWorkingTaskId] = useState<number | null>(null);
  const [editingTask, setEditingTask] = useState<ContactCrmWorkspaceTask | null>(null);
  const [error, setError] = useState('');

  const filtered = useMemo(() => tasks.filter(task => {
    const needle = search.trim().toLocaleLowerCase('en-AU');
    const matchesSearch = !needle || [task.title, task.description, task.contact_name, task.contact_company]
      .some(value => String(value ?? '').toLocaleLowerCase('en-AU').includes(needle));
    return matchesSearch
      && (dueFilter === 'all' || dueBucket(task.due_date) === dueFilter)
      && (priorityFilter === 'all' || task.priority === priorityFilter)
      && (assigneeFilter === 'all'
        || (assigneeFilter === 'unassigned' ? !task.assigned_user_id : String(task.assigned_user_id) === assigneeFilter));
  }), [assigneeFilter, dueFilter, priorityFilter, search, tasks]);

  const updateStatus = async (task: ContactCrmWorkspaceTask, status: 'completed' | 'cancelled') => {
    setWorkingTaskId(task.id);
    setError('');
    try {
      const response = await fetch(`/api/ims/contacts/${task.contact_id}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Task could not be updated.');
      await onTaskChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task could not be updated.');
    } finally {
      setWorkingTaskId(null);
    }
  };

  const saveTask = async (payload: ContactCrmTaskEditPayload) => {
    if (!editingTask) return;
    setWorkingTaskId(editingTask.id);
    setError('');
    try {
      const response = await fetch(`/api/ims/contacts/${editingTask.contact_id}/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const responsePayload = await response.json().catch(() => ({}));
      if (!response.ok || responsePayload.success === false) throw new Error(responsePayload.error || 'Task could not be updated.');
      setEditingTask(null);
      await onTaskChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Task could not be updated.');
    } finally {
      setWorkingTaskId(null);
    }
  };

  const widths = [110, 280, 160, 100, 150, 150];
  const tableWidth = widths.reduce((sum, width) => sum + width, 0);
  const colGroup = () => <colgroup>{widths.map((width, index) => <col key={index} style={{ width, minWidth: width }} />)}</colgroup>;
  const frozen = (background: string): React.CSSProperties => ({
    position: 'sticky', left: 0, zIndex: 3, background, boxShadow: '1px 0 0 var(--sv-etch)',
  });
  const columns = ['Customer', 'Task', 'Due', 'Priority', 'Assignee', 'Actions'];

  return (
    <section style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search tasks or customers…" style={{ ...inputStyle, flex: '1 1 240px' }} />
        <select value={dueFilter} onChange={event => setDueFilter(event.target.value)} style={{ ...inputStyle, flex: '0 1 160px' }} aria-label="Due date">
          <option value="all">All due dates</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="upcoming">Upcoming</option>
          <option value="none">No due date</option>
        </select>
        <select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value)} style={{ ...inputStyle, flex: '0 1 150px' }} aria-label="Priority">
          <option value="all">All priorities</option>
          <option value="high">High priority</option>
          <option value="normal">Normal priority</option>
          <option value="low">Low priority</option>
        </select>
        <select value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)} style={{ ...inputStyle, flex: '0 1 180px' }} aria-label="Assignee">
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {assignees.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12, fontSize: 12, color: 'var(--sv-text-dim)' }}>
        <span><strong style={{ color: 'var(--sv-text-strong)' }}>{tasks.length}</strong> open</span>
        <span><strong style={{ color: 'var(--sv-red)' }}>{tasks.filter(task => dueBucket(task.due_date) === 'overdue').length}</strong> overdue</span>
        <span><strong style={{ color: 'var(--sv-text-strong)' }}>{tasks.filter(task => dueBucket(task.due_date) === 'today').length}</strong> due today</span>
      </div>
      {truncated && <div style={{ color: 'var(--sv-amber)', fontSize: 12, marginBottom: 10 }}>Showing the first 500 open tasks. Use filters to narrow the queue.</div>}
      {error && <div role="alert" style={{ color: 'var(--sv-red)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {filtered.length === 0 ? (
        <div style={{ padding: '38px 0', textAlign: 'center', color: 'var(--sv-text-dim)', fontSize: 13 }}>No open tasks match these filters.</div>
      ) : (
        <div style={{ width: '100%', minWidth: 0, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
          <div ref={headerScrollRef} style={{ position: 'sticky', top: 0, zIndex: 20, overflow: 'hidden', background: 'var(--sv-bg-2)', borderRadius: '8px 8px 0 0' }}>
            <table style={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
              {colGroup()}
              <thead><tr>{columns.map((column, index) => <th key={column} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--sv-text-dim)', textTransform: 'uppercase', ...(index === 0 ? frozen('var(--sv-bg-2)') : {}) }}>{column}</th>)}</tr></thead>
            </table>
          </div>
          <div
            ref={bodyScrollRef}
            className="ims-sticky-table ims-sticky-table--self-scroll crm-task-queue-scroll"
            tabIndex={0}
            role="region"
            aria-label="CRM task queue. Use arrow keys to scroll."
            onScroll={event => { if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft; }}
            style={{ width: '100%', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', outline: 'none' }}
          >
            <table style={{ width: tableWidth, minWidth: '100%', tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 }}>
              {colGroup()}
              <tbody>{filtered.map((task, index) => {
                const background = index % 2 ? 'color-mix(in srgb, rgb(148 163 184) 4%, var(--sv-bg-1))' : 'var(--sv-bg-1)';
                const due = dueLabel(task.due_date);
                return <tr key={task.id} style={{ background }}>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)', ...frozen(background) }}>
                    <button onClick={() => onOpenProfile(task.contact_id)} title={task.contact_name} style={{ width: '100%', border: 0, background: 'none', padding: 0, color: 'var(--sv-action)', fontWeight: 700, cursor: 'pointer', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.contact_name}</button>
                    {task.contact_company && <div title={task.contact_company} style={{ fontSize: 10, color: 'var(--sv-text-dim)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.contact_company}</div>}
                  </td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)' }}><strong style={{ fontSize: 13 }}>{task.title}</strong>{task.description && <div style={{ marginTop: 3, color: 'var(--sv-text-dim)', fontSize: 11, overflowWrap: 'anywhere' }}>{task.description}</div>}</td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)', color: due.bucket === 'overdue' ? 'var(--sv-red)' : 'var(--sv-text-main)', fontWeight: due.bucket === 'overdue' || due.bucket === 'today' ? 700 : 400 }}>{due.label}</td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)', textTransform: 'capitalize' }}>{task.priority}</td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)' }}>{task.assigned_user_name || <span style={{ color: 'var(--sv-text-dim)' }}>Unassigned</span>}</td>
                  <td style={{ padding: '10px 12px', borderTop: '1px solid var(--sv-etch)' }}>{!isAdvisor && <div style={{ display: 'flex', gap: 5 }}>
                    <button disabled={workingTaskId === task.id} onClick={() => setEditingTask(task)} title="Edit task" style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-1)', color: 'var(--sv-action)', padding: 6, cursor: 'pointer', display: 'flex' }}><Pencil size={14} /></button>
                    <button disabled={workingTaskId === task.id} onClick={() => updateStatus(task, 'completed')} title="Complete task" style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-1)', color: 'var(--sv-mint)', padding: 6, cursor: 'pointer', display: 'flex' }}><Check size={14} /></button>
                    <button disabled={workingTaskId === task.id} onClick={() => updateStatus(task, 'cancelled')} title="Cancel task" style={{ border: '1px solid var(--sv-etch)', borderRadius: 5, background: 'var(--sv-bg-1)', color: 'var(--sv-text-dim)', padding: 6, cursor: 'pointer', display: 'flex' }}><X size={14} /></button>
                  </div>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      )}
      {editingTask && <ContactCrmTaskEditor task={editingTask} assignees={assignees} saving={workingTaskId === editingTask.id} onClose={() => setEditingTask(null)} onSave={saveTask} />}
    </section>
  );
}