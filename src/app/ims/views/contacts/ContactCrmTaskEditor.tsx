'use client';

import React, { useEffect, useState } from 'react';

export type ContactCrmEditableTask = {
  id: number;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority: string;
  assigned_user_id?: number | null;
};

export type ContactCrmTaskEditPayload = {
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: string;
  assignedUserId: number | null;
};

const inputStyle: React.CSSProperties = {
  width: '100%', minHeight: 36, boxSizing: 'border-box', border: '1px solid var(--sv-etch)',
  borderRadius: 6, background: 'var(--sv-bg-0)', color: 'var(--sv-text-main)', padding: '7px 10px', fontSize: 13,
};

export function ContactCrmTaskEditor({
  task,
  assignees,
  saving,
  onClose,
  onSave,
}: {
  task: ContactCrmEditableTask;
  assignees: Array<{ id: number; name: string }>;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: ContactCrmTaskEditPayload) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<ContactCrmTaskEditPayload>({
    title: task.title,
    description: task.description ?? null,
    dueDate: task.due_date ? String(task.due_date).slice(0, 10) : null,
    priority: task.priority,
    assignedUserId: task.assigned_user_id ?? null,
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || saving) return;
    await onSave({
      ...draft,
      title: draft.title.trim(),
      description: draft.description?.trim() || null,
    });
  };

  return (
    <div role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,.42)' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="crm-task-editor-title" style={{ width: 'min(520px, 100%)', maxHeight: 'calc(100vh - 32px)', overflowY: 'auto', background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius: 8, boxShadow: '0 18px 50px rgba(0,0,0,.28)' }}>
        <form onSubmit={submit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 11 }}>
          <h2 id="crm-task-editor-title" style={{ margin: 0, fontSize: 17, color: 'var(--sv-text-strong)' }}>Edit follow-up</h2>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-dim)' }}>Task title
            <input autoFocus value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-dim)' }}>Details
            <textarea value={draft.description ?? ''} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} rows={4} style={{ ...inputStyle, marginTop: 4, resize: 'vertical' }} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-dim)' }}>Due date
              <input type="date" value={draft.dueDate ?? ''} onChange={event => setDraft(current => ({ ...current, dueDate: event.target.value || null }))} style={{ ...inputStyle, marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-dim)' }}>Priority
              <select value={draft.priority} onChange={event => setDraft(current => ({ ...current, priority: event.target.value }))} style={{ ...inputStyle, marginTop: 4 }}>
                <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
              </select>
            </label>
          </div>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--sv-text-dim)' }}>Assignee
            <select value={draft.assignedUserId ?? ''} onChange={event => setDraft(current => ({ ...current, assignedUserId: event.target.value ? Number(event.target.value) : null }))} style={{ ...inputStyle, marginTop: 4 }}>
              <option value="">Unassigned</option>
              {assignees.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 3 }}>
            <button type="button" disabled={saving} onClick={onClose} style={{ minHeight: 34, border: '1px solid var(--sv-etch)', borderRadius: 6, background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)', padding: '6px 11px', fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
            <button disabled={saving || !draft.title.trim()} style={{ minHeight: 34, border: 0, borderRadius: 6, background: 'var(--sv-action)', color: '#fff', padding: '6px 12px', fontWeight: 700, cursor: 'pointer' }}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}