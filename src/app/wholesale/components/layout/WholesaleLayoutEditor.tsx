'use client';

import { useEffect, useRef, useState } from 'react';
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
import { ChevronDown, ChevronUp, Copy, GripVertical, Loader2, Plus, RotateCcw, Save, Send, Trash2, Upload } from 'lucide-react';
import { WHOLESALE_LAYOUT_SECTION_REGISTRY } from '@/lib/wholesale/layout/registry';
import { createDefaultWholesaleLayout, getChangedWholesaleLayoutPages, isRequiredWholesaleLayoutSection } from '@/lib/wholesale/layout/validation';
import {
  WHOLESALE_LAYOUT_PAGE_IDS,
  type WholesaleLayoutDocument,
  type WholesaleLayoutPageId,
  type WholesaleLayoutSection,
} from '@/lib/wholesale/layout/types';
import type { WholesaleLayoutEditorState } from '@/lib/wholesale/wholesalePortalLayout';
import type { WholesalePortalAsset } from '@/lib/wholesale/wholesalePortalAsset';
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
  selected,
  onSelect,
  onDuplicate,
  onRemove,
}: {
  section: WholesaleLayoutSection;
  page: WholesaleLayoutPageId;
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  selected: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const sortable = useSortable({ id: section.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[section.type];
  const required = isRequiredWholesaleLayoutSection(page, section.type);
  return (
    <div ref={sortable.setNodeRef} style={style} className={styles.sectionRow} data-dragging={sortable.isDragging || undefined} data-selected={selected || undefined}>
      <button className={styles.dragHandle} {...sortable.attributes} {...sortable.listeners} aria-label={`Reorder ${definition.label}`} title="Drag to reorder"><GripVertical size={16} /></button>
      <button className={styles.sectionIdentity} onClick={onSelect} aria-pressed={selected}><strong>{definition.label}</strong>{required && <span>Required</span>}</button>
      <div className={styles.moveButtons}>
        <button onClick={() => onMove(index, index - 1)} disabled={index === 0} aria-label={`Move ${definition.label} up`} title="Move up"><ChevronUp size={15} /></button>
        <button onClick={() => onMove(index, index + 1)} disabled={index === count - 1} aria-label={`Move ${definition.label} down`} title="Move down"><ChevronDown size={15} /></button>
        {!definition.singleton && <button onClick={onDuplicate} disabled={count >= 40} aria-label={`Duplicate ${definition.label}`} title="Duplicate"><Copy size={14} /></button>}
        {!required && <button onClick={onRemove} aria-label={`Remove ${definition.label}`} title="Remove"><Trash2 size={14} /></button>}
      </div>
    </div>
  );
}

export function WholesaleLayoutEditor({
  onPageChange,
  onDocumentChange,
  onDirtyChange,
  products = [],
}: {
  onPageChange?: (page: WholesaleLayoutPageId | null) => void;
  onDocumentChange?: (document: WholesaleLayoutDocument | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  products?: Array<{ product_id: string; name: string }>;
}) {
  const [state, setState] = useState<WholesaleLayoutEditorState | null>(null);
  const [document, setDocument] = useState<WholesaleLayoutDocument | null>(null);
  const [page, setPage] = useState<WholesaleLayoutPageId>('home');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addType, setAddType] = useState('banner');
  const [productQuery, setProductQuery] = useState('');
  const [assets, setAssets] = useState<WholesalePortalAsset[]>([]);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pendingPage, setPendingPage] = useState<WholesaleLayoutPageId | null>(null);
  const [conflictState, setConflictState] = useState<WholesaleLayoutEditorState | null>(null);
  const [publishConfirmationOpen, setPublishConfirmationOpen] = useState(false);
  const [working, setWorking] = useState<'load' | 'save' | 'publish' | 'reset' | null>('load');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const callbacksRef = useRef({ onPageChange, onDocumentChange, onDirtyChange });
  callbacksRef.current = { onPageChange, onDocumentChange, onDirtyChange };
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

  useEffect(() => {
    fetch('/api/ims/wholesale/layout/assets')
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Layout images could not be loaded.');
        setAssets(body.assets ?? []);
      })
      .catch(loadError => setError(loadError instanceof Error ? loadError.message : 'Layout images could not be loaded.'));
  }, []);

  useEffect(() => onPageChange?.(page), [onPageChange, page]);
  useEffect(() => onDocumentChange?.(document), [document, onDocumentChange]);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  useEffect(() => () => {
    callbacksRef.current.onPageChange?.(null);
    callbacksRef.current.onDocumentChange?.(null);
    callbacksRef.current.onDirtyChange?.(false);
  }, []);

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

  const updateSections = (sections: WholesaleLayoutSection[]) => {
    if (!document) return;
    setDocument({ ...document, pages: { ...document.pages, [page]: { sections } } });
    setDirty(true);
    setMessage('');
  };

  const uniqueId = (type: WholesaleLayoutSection['type']) => `${page}-${type}-${crypto.randomUUID()}`;
  const addSection = () => {
    if (!document) return;
    const definition = WHOLESALE_LAYOUT_SECTION_REGISTRY[addType as WholesaleLayoutSection['type']];
    if (!definition || !definition.allowedPages.includes(page)) return;
    if (definition.singleton && document.pages[page].sections.some(section => section.type === definition.type)) return;
    const section = { id: uniqueId(definition.type), type: definition.type, settings: { ...definition.defaultSettings } };
    updateSections([...document.pages[page].sections, section]);
    setSelectedId(section.id);
  };

  const duplicateSection = (section: WholesaleLayoutSection) => {
    const sections = document?.pages[page].sections;
    if (!sections || WHOLESALE_LAYOUT_SECTION_REGISTRY[section.type].singleton) return;
    const index = sections.findIndex(candidate => candidate.id === section.id);
    const copy = { ...section, id: uniqueId(section.type), settings: { ...section.settings } };
    updateSections([...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)]);
    setSelectedId(copy.id);
  };

  const removeSection = (section: WholesaleLayoutSection) => {
    if (!document || isRequiredWholesaleLayoutSection(page, section.type)) return;
    updateSections(document.pages[page].sections.filter(candidate => candidate.id !== section.id));
    if (selectedId === section.id) setSelectedId(null);
  };

  const resetSelectedSection = (section: WholesaleLayoutSection) => {
    if (!confirm(`Reset ${WHOLESALE_LAYOUT_SECTION_REGISTRY[section.type].label} to its default settings?`)) return;
    const defaults = WHOLESALE_LAYOUT_SECTION_REGISTRY[section.type].defaultSettings;
    const settings = { ...defaults, productIds: defaults.productIds ? [...defaults.productIds] : undefined };
    updateSections(document!.pages[page].sections.map(candidate => candidate.id === section.id ? { ...candidate, settings } : candidate));
    setMessage('Section reset locally. Save the draft to keep this change.');
  };

  const resetCurrentPage = () => {
    if (!document || !confirm(`Reset the ${pageLabels[page]} page to its default sections? Optional sections on this page will be removed.`)) return;
    const defaultSections = createDefaultWholesaleLayout().pages[page].sections;
    updateSections(defaultSections);
    setSelectedId(null);
    setMessage(`${pageLabels[page]} reset locally. Save the draft to keep this change.`);
  };

  const updateSettings = (patch: Partial<WholesaleLayoutSection['settings']>) => {
    if (!document || !selectedId) return;
    updateSections(document.pages[page].sections.map(section => section.id === selectedId
      ? { ...section, settings: { ...section.settings, ...patch } }
      : section));
  };

  const updateSetting = (key: keyof WholesaleLayoutSection['settings'], value: string | number | string[] | undefined) => updateSettings({ [key]: value || undefined });

  const selectAsset = (asset: WholesalePortalAsset) => {
    updateSettings({ assetId: asset.assetId, imageUrl: undefined, altText: selected?.settings.altText || asset.altText || undefined });
  };

  const uploadAsset = async (file?: File) => {
    if (!file) return;
    setUploadingAsset(true); setError('');
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('altText', selected?.settings.altText ?? '');
      const response = await fetch('/api/ims/wholesale/layout/assets', { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'The layout image could not be uploaded.');
      setAssets(current => [body.asset, ...current]);
      selectAsset(body.asset);
      setMessage('Image uploaded. Save the draft to keep this section selection.');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'The layout image could not be uploaded.');
    } finally { setUploadingAsset(false); }
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!document || !over || active.id === over.id) return;
    const sections = document.pages[page].sections;
    reorder(sections.findIndex(section => section.id === active.id), sections.findIndex(section => section.id === over.id));
  };

  const perform = async (action: 'save_draft' | 'publish' | 'reset_draft') => {
    if (!state || !document) return false;
    if (action === 'publish' && dirty) { setError('Save the draft before publishing.'); return false; }
    if (action === 'reset_draft' && !confirm('Reset the draft to the currently published layout?')) return false;
    setWorking(action === 'save_draft' ? 'save' : action === 'publish' ? 'publish' : 'reset');
    setError(''); setMessage('');
    try {
      const response = await fetch('/api/ims/wholesale/layout', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, expectedRevision: state.draftRevision, document: action === 'save_draft' ? document : undefined }),
      });
      const body = await response.json();
      if (response.status === 409 && body.code === 'wholesale_layout_revision_conflict') {
        const latestResponse = await fetch('/api/ims/wholesale/layout');
        const latestBody = await latestResponse.json();
        if (!latestResponse.ok || !latestBody.success) throw new Error(latestBody.error || 'The latest layout could not be loaded.');
        setConflictState(latestBody.state);
        setError('');
        return false;
      }
      if (!response.ok || !body.success) throw new Error(body.error || 'Layout could not be updated.');
      setState(body.state);
      setDocument(body.state.draft);
      setDirty(false);
      if (action === 'publish') setPublishConfirmationOpen(false);
      setMessage(action === 'publish' ? 'Published.' : action === 'reset_draft' ? 'Draft reset.' : 'Draft saved.');
      return true;
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Layout could not be updated.');
      return false;
    } finally { setWorking(null); }
  };

  const changePage = (nextPage: WholesaleLayoutPageId) => {
    setPage(nextPage);
    setSelectedId(null);
    setPendingPage(null);
  };

  const requestPageChange = (nextPage: WholesaleLayoutPageId) => {
    if (nextPage === page) return;
    if (dirty) { setPendingPage(nextPage); return; }
    changePage(nextPage);
  };

  const saveAndChangePage = async () => {
    if (!pendingPage) return;
    const nextPage = pendingPage;
    if (await perform('save_draft')) changePage(nextPage);
  };

  const discardAndChangePage = () => {
    if (!pendingPage || !state) return;
    setDocument(state.draft);
    setDirty(false);
    setError('');
    setMessage('Unsaved changes discarded.');
    changePage(pendingPage);
  };

  const reloadConflictDraft = () => {
    if (!conflictState) return;
    setState(conflictState);
    setDocument(conflictState.draft);
    setDirty(false);
    setSelectedId(null);
    setPendingPage(null);
    setConflictState(null);
    setPublishConfirmationOpen(false);
    setMessage('Latest saved draft loaded.');
  };

  const keepLocalConflictDraft = () => {
    if (!conflictState) return;
    setState(conflictState);
    setConflictState(null);
    setDirty(true);
    setPublishConfirmationOpen(false);
    setMessage('Local changes kept. Save again to replace the latest draft.');
  };

  const sections = document?.pages[page].sections ?? [];
  const selected = sections.find(section => section.id === selectedId) ?? null;
  const visibleProducts = products.filter(product => product.name.toLocaleLowerCase('en-AU').includes(productQuery.trim().toLocaleLowerCase('en-AU'))).slice(0, 30);
  const addable = sections.length >= 40 ? [] : Object.values(WHOLESALE_LAYOUT_SECTION_REGISTRY).filter(definition => definition.allowedPages.includes(page) && !definition.requiredOn?.includes(page) && (!definition.singleton || !sections.some(section => section.type === definition.type)));
  const changedPages = state ? getChangedWholesaleLayoutPages(state.draft, state.published) : [];
  const lastPublished = state?.publishedBy?.at
    ? `${state.publishedBy.name || 'Unknown staff member'} on ${new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(state.publishedBy.at))}`
    : 'Never published';
  return (
    <aside className={styles.editor} aria-label="Wholesale layout editor">
      <header className={styles.header}>
        <span>Layout editor</span>
        <h2>Page sections</h2>
        <select value={page} onChange={event => requestPageChange(event.target.value as WholesaleLayoutPageId)} aria-label="Page template">
          {WHOLESALE_LAYOUT_PAGE_IDS.map(pageId => <option key={pageId} value={pageId}>{pageLabels[pageId]}</option>)}
        </select>
        <button className={styles.resetPage} type="button" onClick={resetCurrentPage} disabled={!document || Boolean(working)}><RotateCcw size={14} /> Reset page</button>
      </header>
      <div className={styles.body}>
        {working === 'load' ? <div className={styles.loading}><Loader2 size={18} /> Loading layout...</div> : error && !document ? <div className={styles.error}>{error}</div> : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sections.map(section => section.id)} strategy={verticalListSortingStrategy}>
              <div className={styles.sectionList}>{sections.map((section, index) => (
                <SortableSection key={section.id} section={section} page={page} index={index} count={sections.length} onMove={reorder} selected={selectedId === section.id} onSelect={() => setSelectedId(section.id)} onDuplicate={() => duplicateSection(section)} onRemove={() => removeSection(section)} />
              ))}</div>
            </SortableContext>
          </DndContext>
        )}
        {document && <div className={styles.addSection}><select value={addType} onChange={event => setAddType(event.target.value)} aria-label="Section type to add">{addable.map(definition => <option key={definition.type} value={definition.type}>{definition.label}</option>)}</select><button onClick={addSection} disabled={!addable.length}><Plus size={15} /> Add section</button></div>}
        {selected && <div className={styles.settings}>
          <div className={styles.settingsHeader}><h3>{WHOLESALE_LAYOUT_SECTION_REGISTRY[selected.type].label}</h3><button type="button" onClick={() => resetSelectedSection(selected)}><RotateCcw size={13} /> Reset</button></div>
          {'heading' in WHOLESALE_LAYOUT_SECTION_REGISTRY[selected.type].defaultSettings && <label>Heading<input value={selected.settings.heading ?? ''} maxLength={255} onChange={event => updateSetting('heading', event.target.value)} /></label>}
          {'bodyHtml' in WHOLESALE_LAYOUT_SECTION_REGISTRY[selected.type].defaultSettings && <label>Body HTML<textarea value={selected.settings.bodyHtml ?? ''} maxLength={20000} rows={5} onChange={event => updateSetting('bodyHtml', event.target.value)} /></label>}
          {(selected.type === 'image' || selected.type === 'text_image') && <><div className={styles.assetUpload}><label><Upload size={15} /> {uploadingAsset ? 'Uploading...' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploadingAsset} onChange={event => { void uploadAsset(event.target.files?.[0]); event.target.value = ''; }} /></label><span>JPEG, PNG, WebP or GIF · 10 MB max</span></div>{assets.length > 0 && <div className={styles.assetGrid} aria-label="Uploaded layout images">{assets.map(asset => <button key={asset.assetId} type="button" data-selected={selected.settings.assetId === asset.assetId || undefined} onClick={() => selectAsset(asset)} title={asset.originalName}><img src={asset.url} alt={asset.altText ?? ''} /><span>{asset.originalName}</span></button>)}</div>}<label>Or image URL<input type="url" value={selected.settings.imageUrl ?? ''} maxLength={2048} placeholder="https://" onChange={event => updateSettings({ imageUrl: event.target.value || undefined, assetId: undefined })} /></label><label>Alt text<input value={selected.settings.altText ?? ''} maxLength={500} onChange={event => updateSetting('altText', event.target.value)} /></label></>}
          {(selected.type === 'banner' || selected.type === 'rich_text' || selected.type === 'text_image') && <label>Alignment<select value={selected.settings.alignment ?? 'left'} onChange={event => updateSetting('alignment', event.target.value)}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>}
          {!WHOLESALE_LAYOUT_SECTION_REGISTRY[selected.type].singleton && selected.type !== 'spacer' && <label>Width<select value={selected.settings.width ?? 'content'} onChange={event => updateSetting('width', event.target.value)}><option value="narrow">Narrow</option><option value="content">Content</option><option value="full">Full width</option></select></label>}
          {!WHOLESALE_LAYOUT_SECTION_REGISTRY[selected.type].singleton && <><label>Space above<select value={selected.settings.spacingTop ?? 'medium'} onChange={event => updateSetting('spacingTop', event.target.value)}><option value="none">None</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label><label>Space below<select value={selected.settings.spacingBottom ?? 'medium'} onChange={event => updateSetting('spacingBottom', event.target.value)}><option value="none">None</option><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label></>}
          {(selected.type === 'banner' || selected.type === 'rich_text' || selected.type === 'text_image') && <><label>Background colour<input value={selected.settings.backgroundColor ?? ''} maxLength={32} placeholder="#ffffff" onChange={event => updateSetting('backgroundColor', event.target.value)} /></label><label>Text colour<input value={selected.settings.textColor ?? ''} maxLength={32} placeholder="#17201c" onChange={event => updateSetting('textColor', event.target.value)} /></label><label>Link label<input value={selected.settings.linkLabel ?? ''} maxLength={100} onChange={event => updateSetting('linkLabel', event.target.value)} /></label><label>Link URL<input type="url" value={selected.settings.linkUrl ?? ''} maxLength={2048} placeholder="https:// or /catalogue" onChange={event => updateSetting('linkUrl', event.target.value)} /></label></>}
          {selected.type === 'text_image' && <label>Image side<select value={selected.settings.imageSide ?? 'right'} onChange={event => updateSetting('imageSide', event.target.value)}><option value="left">Left</option><option value="right">Right</option></select></label>}
          {(selected.type === 'image' || selected.type === 'text_image') && <><label>Image fit<select value={selected.settings.imageFit ?? 'cover'} onChange={event => updateSetting('imageFit', event.target.value)}><option value="cover">Cover</option><option value="contain">Contain</option></select></label><label>Image ratio<select value={selected.settings.imageRatio ?? 'landscape'} onChange={event => updateSetting('imageRatio', event.target.value)}><option value="landscape">Landscape</option><option value="square">Square</option><option value="portrait">Portrait</option></select></label></>}
          {selected.type === 'featured_products' && <><label>Product limit<input type="number" min={1} max={12} value={selected.settings.productLimit ?? 4} onChange={event => updateSetting('productLimit', Number(event.target.value))} /></label><label>Find products<input type="search" value={productQuery} onChange={event => setProductQuery(event.target.value)} /></label><div className={styles.productPicker}>{visibleProducts.map(product => { const checked = selected.settings.productIds?.includes(product.product_id) ?? false; const atLimit = (selected.settings.productIds?.length ?? 0) >= 24; return <label key={product.product_id}><input type="checkbox" checked={checked} disabled={!checked && atLimit} onChange={() => updateSetting('productIds', checked ? (selected.settings.productIds ?? []).filter(id => id !== product.product_id) : [...(selected.settings.productIds ?? []), product.product_id])} /><span>{product.name}</span></label>; })}</div></>}
        </div>}
      </div>
      <footer className={styles.footer}>
        {(error || message) && <div className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{error || message}</div>}
        <div className={styles.revisions}>Draft r{state?.draftRevision ?? 0} · Published r{state?.publishedRevision ?? 0}{dirty ? ' · Unsaved changes' : ''}</div>
        <button className={styles.secondary} onClick={() => void perform('reset_draft')} disabled={!state || Boolean(working)}><RotateCcw size={15} /> Reset draft</button>
        <button className={styles.secondary} onClick={() => void perform('save_draft')} disabled={!state || !dirty || Boolean(working)}><Save size={15} /> {working === 'save' ? 'Saving...' : 'Save draft'}</button>
        <button className={styles.primary} onClick={() => setPublishConfirmationOpen(true)} disabled={!state || dirty || Boolean(working)}><Send size={15} /> {working === 'publish' ? 'Publishing...' : 'Publish'}</button>
      </footer>
      {pendingPage && !conflictState && <div className={styles.dialogLayer} role="presentation">
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="layout-page-change-title" aria-describedby="layout-page-change-description" onKeyDown={event => { if (event.key === 'Escape' && !working) setPendingPage(null); }}>
          <h3 id="layout-page-change-title">Save changes before switching?</h3>
          <p id="layout-page-change-description">You have unsaved layout changes. Save or discard them before opening {pageLabels[pendingPage]}.</p>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} onClick={() => setPendingPage(null)} disabled={Boolean(working)} autoFocus>Cancel</button>
            <button type="button" className={styles.danger} onClick={discardAndChangePage} disabled={Boolean(working)}>Discard</button>
            <button type="button" className={styles.primary} onClick={() => void saveAndChangePage()} disabled={Boolean(working)}>{working === 'save' ? 'Saving...' : 'Save draft'}</button>
          </div>
        </div>
      </div>}
      {conflictState && <div className={styles.dialogLayer} role="presentation">
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="layout-conflict-title" aria-describedby="layout-conflict-description">
          <h3 id="layout-conflict-title">Layout changed elsewhere</h3>
          <p id="layout-conflict-description">Another editor saved draft r{conflictState.draftRevision} after you opened this layout. Reload their version, or keep your local changes and save again to replace it.</p>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} onClick={reloadConflictDraft} autoFocus>Reload</button>
            <button type="button" className={styles.primary} onClick={keepLocalConflictDraft}>Keep local</button>
          </div>
        </div>
      </div>}
      {publishConfirmationOpen && !conflictState && <div className={styles.dialogLayer} role="presentation">
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="layout-publish-title" aria-describedby="layout-publish-description" onKeyDown={event => { if (event.key === 'Escape' && !working) setPublishConfirmationOpen(false); }}>
          <h3 id="layout-publish-title">Publish saved layout?</h3>
          <p id="layout-publish-description">This makes the saved draft visible across the wholesale portal.</p>
          <strong className={styles.dialogLabel}>Changed templates</strong>
          {changedPages.length > 0
            ? <ul className={styles.changeList}>{changedPages.map(pageId => <li key={pageId}>{pageLabels[pageId]}</li>)}</ul>
            : <p className={styles.noChanges}>No page content differs from the published layout.</p>}
          <div className={styles.publishMeta}><span>Last published</span><strong>{lastPublished}</strong></div>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.secondary} onClick={() => setPublishConfirmationOpen(false)} disabled={Boolean(working)} autoFocus>Cancel</button>
            <button type="button" className={styles.primary} onClick={() => void perform('publish')} disabled={Boolean(working)}><Send size={15} /> {working === 'publish' ? 'Publishing...' : 'Publish now'}</button>
          </div>
        </div>
      </div>}
    </aside>
  );
}