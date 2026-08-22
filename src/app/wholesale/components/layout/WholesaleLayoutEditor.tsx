'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical, Loader2, RotateCcw, Save, Send } from 'lucide-react';
import { WHOLESALE_LAYOUT_SECTION_REGISTRY } from '@/lib/wholesale/layout/registry';
import { isRequiredWholesaleLayoutSection } from '@/lib/wholesale/layout/validation';
import {
  WHOLESALE_LAYOUT_PAGE_IDS,
  type WholesaleLayoutDocument,
  type WholesaleLayoutPageId,
  type WholesaleLayoutSection,
} from '@/lib/wholesale/layout/types';
import type { WholesaleLayoutEditorState } from '@/lib/wholesale/wholesalePortalLayout';
import styles from './WholesaleLayoutEditor.module.css';

const pageLabels: Record<WholesaleLayoutPageId, string> = {
  login: 'Login', home: 'Home', catalogue: 'Catalogue', cart: 'Cart',
  collection: 'Category / Subcategory', product: 'Product',
};

function SortableSection({
  section,
  page,
  index,
  count,
  onMove,
}: {
  section: WholesaleLayoutSection;
  page: WholesaleLayoutPageId;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
}) {
  const sortable = useSortable({ id: section.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[section.type];
  const required = isRequiredWholesaleLayoutSection(page, section.type);
  return (
    <div ref={sortable.setNodeRef} style={style} className={styles.sectionRow} data-dragging={sortable.isDragging || undefined}>
      <button className={styles.dragHandle} {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${definition.label}`} title="Drag to reorder"><GripVertical size={16} /></button>
      <div className={styles.sectionIdentity}><strong>{definition.label}</strong>{required && <span>Required</span>}</div>
      <div className={styles.moveButtons}>
        <button onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`Move ${definition.label} up`} title="Move up"><ChevronUp size={15} /></button>
        <button onClick={() => onMove(index, index + 1)} disabled={index === count - 1} aria-label={`Move ${definition.label} down`} title="Move down"><ChevronDown size={15} /></button>
      </div>
    </div>
  );
}

export function WholesaleLayoutEditor({
  onPageChange,
  onDocumentChange,
  onDirtyChange,
}: {
  onPageChange?: (page: WholesaleLayoutPageId | null) => void;
  onDocumentChange?: (document: WholesaleLayoutDocument | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [state, setState] = useState<WholesaleLayoutEditorState | null>(null);
  const [document, setDocument] = useState<WholesaleLayoutDocument | null>(null);
  const [page, setPage] = useState<WholesaleLayoutPageId>('home');
  const [dirty, setDirty] = useState(false);
  const [working, setWorking] = useState<'load' | 'save' | 'publish' | 'reset' | null>('load');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    fetch('/api/ims/wholesale/layout')
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Layout could not be loaded.');
        setState(body.state);
        setDocument(body.state.draft);
      })
      .catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Layout could not be loaded.'))
      .finally(() => setWorking(null));
  }, []);

  useEffect(() => onPageChange?.(page), [onPageChange, page]);
  useEffect(() => onDocumentChange?.(document), [document, onDocumentChange]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => {
    onPageChange?.(null);
    onDocumentChange?.(null);
    onDirtyChange?.(false);
  }, [onDirtyChange, onDocumentChange, onPageChange]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const reorder = (from: number, to: number) => {
    if (!document || to < 0 || to >= document.pages[page].sections.length || from === to) return;
    setDocument({
      ...document,
      pages: { ...document.pages, [page]: { sections: arrayMove(document.pages[page].sections, from, to) } },
    });
    setDirty(true);
    setMessage('');
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!document || !over || active.id === over.id) return;
    const sections = document.pages[page].sections;
    reorder(sections.findIndex(section => section.id === active.id), sections.findIndex(section => section.id === over.id));
  };

  const perform = async (action: 'save_draft' | 'publish' | 'reset_draft') => {
    if (!state || !document) return;
    if (action === 'publish' && dirty) { setError('Save the draft before publishing.'); return; }
    if (action === 'reset_draft' && !confirm('Reset the draft to the currently published layout?')) return;
    if (action === 'publish' && !confirm('Publish the saved layout across all wholesale portal pages?')) return;
    setWorking(action === 'save_draft' ? 'save' : action === 'publish' ? 'publish' : 'reset');
    setError(''); setMessage('');
    try {
      const response = await fetch('/api/ims/wholesale/layout', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedRevision: state.draftRevision, document: action === 'save_draft' ? document : undefined }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'Layout could not be updated.');
      setState(body.state);
      setDocument(body.state.draft);
      setDirty(false);
      setMessage(action === 'publish' ? 'Published.' : action === 'reset_draft' ? 'Draft reset.' : 'Draft saved.');
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Layout could not be updated.');
    } finally { setWorking(null); }
  };

  const sections = document?.pages[page].sections ?? [];
  return (
    <aside className={styles.editor} aria-label="Wholesale layout editor">
      <header className={styles.header}>
        <span>Layout editor</span>
        <h2>Page sections</h2>
        <select value={page} onChange={event => setPage(event.target.value as WholesaleLayoutPageId)} aria-label="Page template">
          {WHOLESALE_LAYOUT_PAGE_IDS.map(pageId => <option key={pageId} value={pageId}>{pageLabels[pageId]}</option>)}
        </select>
      </header>
      <div className={styles.body}>
        {working === 'load' ? <div className={styles.loading}><Loader2 size={18} /> Loading layout...</div> : error && !document ? <div className={styles.error}>{error}</div> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map(section => section.id)} strategy={verticalListSortingStrategy}>
              <div className={styles.sectionList}>{sections.map((section, index) => (
                <SortableSection key={section.id} section={section} page={page} index={index} count={sections.length} onMove={reorder} />
              ))}</div>
            </SortableContext>
          </DndContext>
        )}
      </div>
      <footer className={styles.footer}>
        {(error || message) && <div className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{error || message}</div>}
        <div className={styles.revisions}>Draft r{state?.draftRevision ?? 0} · Published r{state?.publishedRevision ?? 0}{dirty ? ' · Unsaved changes' : ''}</div>
        <button className={styles.secondary} onClick={() => void perform('reset_draft')} disabled={!state || Boolean(working)}><RotateCcw size={15} /> Reset draft</button>
        <button className={styles.secondary} onClick={() => void perform('save_draft')} disabled={!state || !dirty || Boolean(working)}><Save size={15} /> {working === 'save' ? 'Saving...' : 'Save draft'}</button>
        <button className={styles.primary} onClick={() => void perform('publish')} disabled={!state || dirty || Boolean(working)}><Send size={15} /> {working === 'publish' ? 'Publishing...' : 'Publish'}</button>
      </footer>
    </aside>
  );
}