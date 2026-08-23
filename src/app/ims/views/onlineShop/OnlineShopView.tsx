'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, FilePlus2, ImagePlus, Loader2, Plus, RotateCcw, Save, Send, Store, Trash2 } from 'lucide-react';
import { ONLINE_SHOP_LAYOUT_SECTION_REGISTRY } from '@/lib/onlineShop/layout/registry';
import { ONLINE_SHOP_LAYOUT_PAGE_IDS, ONLINE_SHOP_SHARED_SECTION_TYPES, type OnlineShopContentPageDocument,
  type OnlineShopLayoutDocument, type OnlineShopLayoutPageId, type OnlineShopLayoutSection, type OnlineShopLayoutSectionType } from '@/lib/onlineShop/layout/types';
import type { OnlineShopAsset } from '@/lib/onlineShop/onlineShopAsset';
import type { OnlineShopLayoutEditorState } from '@/lib/onlineShop/onlineShopLayout';
import type { OnlineShopPageEditorState, OnlineShopPageSummary } from '@/lib/onlineShop/onlineShopPages';
import type { OnlineShopProfile } from '@/lib/onlineShop/onlineShopProfile';
import type { OnlineSalesChannel } from '@/lib/storefront/channel';
import type { StorefrontLayoutSection } from '@/lib/storefront/layout';
import styles from './OnlineShopView.module.css';

type Tab = 'profile' | 'products' | 'layout' | 'pages';
interface PublicationProduct { product_id: string; name: string; brand: string | null; base_sku: string | null;
  shopify_product_id: string | null; slug: string | null; is_published: number; retail_variant_count: number | string }
interface FulfilmentLocation { id: number; name: string; priority: number }
const pageLabels: Record<OnlineShopLayoutPageId, string> = { home: 'Home', catalogue: 'Catalogue', collection: 'Collection',
  product: 'Product', cart: 'Cart', checkout: 'Checkout', login: 'Sign in', account: 'Account' };

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init); const body = await response.json();
  if (!response.ok || body.success === false) { const error = new Error(body.error || 'Request failed.'); (error as any).status = response.status; throw error; }
  return body;
}

function SectionComposer({ sections, allowedTypes, requiredTypes, assets, onChange }: {
  sections: StorefrontLayoutSection<string>[]; allowedTypes: readonly string[]; requiredTypes: ReadonlySet<string>;
  assets: OnlineShopAsset[]; onChange: (sections: StorefrontLayoutSection<string>[]) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addType, setAddType] = useState(allowedTypes[0] ?? 'banner');
  const selected = sections.find(section => section.id === selectedId) ?? null;
  const move = (index: number, offset: number) => {
    const target = index + offset; if (target < 0 || target >= sections.length) return;
    const next = [...sections]; [next[index], next[target]] = [next[target], next[index]]; onChange(next);
  };
  const add = () => {
    const definition = ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[addType as OnlineShopLayoutSectionType]; if (!definition) return;
    if (definition.singleton && sections.some(section => section.type === addType)) return;
    const section = { id: `${addType}-${crypto.randomUUID()}`, type: addType, settings: { ...definition.defaultSettings } };
    onChange([...sections, section]); setSelectedId(section.id);
  };
  const updateSettings = (patch: Record<string, unknown>) => selected && onChange(sections.map(section => section.id === selected.id
    ? { ...section, settings: { ...section.settings, ...patch } } : section));
  return <div className={styles.composer}>
    <div className={styles.sectionList}>{sections.map((section, index) => {
      const definition = ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[section.type as OnlineShopLayoutSectionType];
      return <div className={styles.sectionRow} data-selected={section.id === selectedId || undefined} key={section.id}>
        <button className={styles.sectionName} onClick={() => setSelectedId(section.id)}>{definition?.label ?? section.type}{requiredTypes.has(section.type) && <small>Required</small>}</button>
        <button className={styles.iconButton} onClick={() => move(index, -1)} disabled={index === 0} title="Move up"><ArrowUp size={15} /></button>
        <button className={styles.iconButton} onClick={() => move(index, 1)} disabled={index === sections.length - 1} title="Move down"><ArrowDown size={15} /></button>
        {!requiredTypes.has(section.type) && <button className={styles.iconButton} onClick={() => { onChange(sections.filter(item => item.id !== section.id)); if (selectedId === section.id) setSelectedId(null); }} title="Remove"><Trash2 size={15} /></button>}
      </div>;
    })}</div>
    <div className={styles.addRow}><select value={addType} onChange={event => setAddType(event.target.value)}>{allowedTypes.map(type => <option key={type} value={type}>{ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type as OnlineShopLayoutSectionType].label}</option>)}</select><button onClick={add}><Plus size={15} /> Add</button></div>
    {selected && <div className={styles.settingsPanel}>
      <strong>{ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[selected.type as OnlineShopLayoutSectionType]?.label}</strong>
      {'heading' in selected.settings && <label>Heading<input value={selected.settings.heading ?? ''} onChange={event => updateSettings({ heading: event.target.value })} /></label>}
      {'bodyHtml' in selected.settings && <label>Content<textarea rows={5} value={selected.settings.bodyHtml ?? ''} onChange={event => updateSettings({ bodyHtml: event.target.value })} /></label>}
      {['image', 'text_image'].includes(selected.type) && <><label>Image<select value={selected.settings.assetId ?? ''} onChange={event => { const asset = assets.find(item => item.assetId === event.target.value); updateSettings({ assetId: asset?.assetId, imageUrl: asset?.url }); }}><option value="">No image</option>{assets.map(asset => <option value={asset.assetId} key={asset.assetId}>{asset.originalName}</option>)}</select></label><label>Alt text<input value={selected.settings.altText ?? ''} onChange={event => updateSettings({ altText: event.target.value })} /></label></>}
      {'alignment' in selected.settings && <label>Alignment<select value={selected.settings.alignment ?? 'left'} onChange={event => updateSettings({ alignment: event.target.value })}><option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></label>}
      {'backgroundColor' in selected.settings && <label>Background colour<input type="color" value={selected.settings.backgroundColor || '#ffffff'} onChange={event => updateSettings({ backgroundColor: event.target.value })} /></label>}
    </div>}
  </div>;
}

export default function OnlineShopView() {
  const [tab, setTab] = useState<Tab>('profile'); const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(''); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const [profile, setProfile] = useState<OnlineShopProfile | null>(null); const [channel, setChannel] = useState<OnlineSalesChannel>('none');
  const [profileForm, setProfileForm] = useState({ slug: '', displayName: '', supportEmail: '', defaultMetaTitle: '', defaultMetaDescription: '', logoUrl: '',
    fulfilmentMode: 'single_location', dispatchLocationId: '' });
  const [fulfilmentLocations, setFulfilmentLocations] = useState<FulfilmentLocation[]>([]);
  const [layoutState, setLayoutState] = useState<OnlineShopLayoutEditorState | null>(null); const [layout, setLayout] = useState<OnlineShopLayoutDocument | null>(null);
  const [template, setTemplate] = useState<OnlineShopLayoutPageId>('home'); const [layoutDirty, setLayoutDirty] = useState(false);
  const [assets, setAssets] = useState<OnlineShopAsset[]>([]); const [pages, setPages] = useState<OnlineShopPageSummary[]>([]);
  const [products, setProducts] = useState<PublicationProduct[]>([]); const [productQuery, setProductQuery] = useState(''); const [productFilter, setProductFilter] = useState('all');
  const [page, setPage] = useState<OnlineShopPageEditorState | null>(null); const [pageDirty, setPageDirty] = useState(false);
  const [newPage, setNewPage] = useState({ title: '', slug: '' });

  const reloadPages = async () => setPages((await jsonRequest('/api/ims/online-shop/pages')).pages ?? []);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const [profileBody, layoutBody, assetBody, pageBody, productBody] = await Promise.all([
        jsonRequest('/api/ims/online-shop/profile'), jsonRequest('/api/ims/online-shop/layout'),
        jsonRequest('/api/ims/online-shop/assets'), jsonRequest('/api/ims/online-shop/pages'), jsonRequest('/api/ims/online-shop/products')]);
      setProfile(profileBody.profile); setChannel(profileBody.activeChannel); setLayoutState(layoutBody.state); setLayout(layoutBody.state.draft);
      setAssets(assetBody.assets ?? []); setPages(pageBody.pages ?? []);
      setProducts(productBody.products ?? []);
      setFulfilmentLocations(profileBody.fulfilment?.locations ?? []);
      const item = profileBody.profile; setProfileForm({ slug: item?.slug ?? '', displayName: item?.displayName ?? '', supportEmail: item?.supportEmail ?? '',
        defaultMetaTitle: item?.defaultMetaTitle ?? '', defaultMetaDescription: item?.defaultMetaDescription ?? '', logoUrl: item?.logoUrl ?? '',
        fulfilmentMode: profileBody.fulfilment?.settings?.mode ?? 'single_location',
        dispatchLocationId: profileBody.fulfilment?.settings?.dispatchLocationId ? String(profileBody.fulfilment.settings.dispatchLocationId) : '' });
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Online shop could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const run = async (name: string, work: () => Promise<void>) => { setWorking(name); setError(''); setMessage(''); try { await work(); } catch (runError) { setError(runError instanceof Error ? runError.message : 'Request failed.'); } finally { setWorking(''); } };

  const saveProfile = (event: FormEvent) => { event.preventDefault(); void run('profile', async () => {
    const body = await jsonRequest('/api/ims/online-shop/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profileForm) });
    setProfile(body.profile); setMessage('Store settings saved.');
  }); };
  const layoutAction = (action: 'save_draft' | 'reset_draft' | 'publish') => void run(`layout-${action}`, async () => {
    if (!layoutState || !layout) return;
    const body = await jsonRequest('/api/ims/online-shop/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, expectedRevision: layoutState.draftRevision, document: action === 'save_draft' ? layout : undefined }) });
    setLayoutState(body.state); setLayout(body.state.draft); setLayoutDirty(false); setMessage(action === 'publish' ? 'Templates published.' : action === 'reset_draft' ? 'Draft reset.' : 'Draft saved.');
  });
  const upload = (file: File) => void run('upload', async () => { const form = new FormData(); form.set('file', file);
    const body = await jsonRequest('/api/ims/online-shop/assets', { method: 'POST', body: form }); setAssets(current => [body.asset, ...current]); setMessage('Image uploaded.'); });
  const loadProducts = () => void run('load-products', async () => { const body = await jsonRequest(`/api/ims/online-shop/products?q=${encodeURIComponent(productQuery)}&filter=${productFilter}`); setProducts(body.products ?? []); });
  const updatePublication = (product: PublicationProduct, publish: boolean) => void run(`product-${product.product_id}`, async () => {
    await jsonRequest('/api/ims/online-shop/products', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.product_id, slug: product.slug || product.name, isPublished: publish }) });
    setProducts(current => current.map(item => item.product_id === product.product_id ? { ...item, is_published: publish ? 1 : 0, slug: item.slug || item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') } : item));
    setMessage(publish ? 'Product published.' : 'Product unpublished.');
  });
  const createPage = (event: FormEvent) => { event.preventDefault(); void run('create-page', async () => {
    const body = await jsonRequest('/api/ims/online-shop/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newPage) });
    setNewPage({ title: '', slug: '' }); await reloadPages(); setPage(body.page); setPageDirty(false);
  }); };
  const openPage = (pageId: string) => void run('load-page', async () => { const body = await jsonRequest(`/api/ims/online-shop/pages/${pageId}`); setPage(body.page); setPageDirty(false); });
  const pageAction = (action: 'save_draft' | 'reset_draft' | 'publish') => void run(`page-${action}`, async () => {
    if (!page) return; const body = await jsonRequest(`/api/ims/online-shop/pages/${page.pageId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...page, action, expectedRevision: page.draftRevision, document: action === 'save_draft' ? page.draft : undefined }) });
    setPage(body.page); setPageDirty(false); await reloadPages(); setMessage(action === 'publish' ? 'Page published.' : action === 'reset_draft' ? 'Page draft reset.' : 'Page draft saved.');
  });
  const deletePage = () => page && confirm(`Delete “${page.title}”?`) && void run('delete-page', async () => {
    await jsonRequest(`/api/ims/online-shop/pages/${page.pageId}`, { method: 'DELETE' }); setPage(null); await reloadPages(); setMessage('Page deleted.'); });

  if (loading) return <div className={styles.loading}><Loader2 size={18} /> Loading online shop...</div>;
  return <div className={styles.workspace}>
    <header className={styles.header}><div><span>Sales channel</span><h1>Online Shop</h1></div><div className={styles.channel} data-active={channel === 'native_shop' || undefined}><Store size={16} /> {channel === 'native_shop' ? 'Native shop active' : channel === 'shopify' ? 'Shopify active' : 'No online channel active'}</div></header>
    <nav className={styles.tabs}>{(['profile', 'products', 'layout', 'pages'] as Tab[]).map(item => <button key={item} data-active={tab === item || undefined} onClick={() => setTab(item)}>{item === 'profile' ? 'Store settings' : item === 'products' ? 'Products' : item === 'layout' ? 'Templates' : 'Pages'}</button>)}</nav>
    {(error || message) && <div className={error ? styles.error : styles.message} role={error ? 'alert' : 'status'}>{error || message}</div>}
    {tab === 'profile' && <form className={styles.form} onSubmit={saveProfile}><div className={styles.formGrid}>
      <label>Store name<input required value={profileForm.displayName} onChange={event => setProfileForm({ ...profileForm, displayName: event.target.value })} /></label>
      <label>Store address<div className={styles.slugInput}><span>/shop/</span><input required value={profileForm.slug} onChange={event => setProfileForm({ ...profileForm, slug: event.target.value })} /></div></label>
      <label>Support email<input type="email" value={profileForm.supportEmail} onChange={event => setProfileForm({ ...profileForm, supportEmail: event.target.value })} /></label>
      <label>Logo<select value={profileForm.logoUrl} onChange={event => setProfileForm({ ...profileForm, logoUrl: event.target.value })}><option value="">No logo</option>{assets.map(asset => <option value={asset.url} key={asset.assetId}>{asset.originalName}</option>)}</select></label>
      <label>Default page title<input value={profileForm.defaultMetaTitle} onChange={event => setProfileForm({ ...profileForm, defaultMetaTitle: event.target.value })} /></label>
      <label className={styles.wide}>Default search description<textarea rows={3} value={profileForm.defaultMetaDescription} onChange={event => setProfileForm({ ...profileForm, defaultMetaDescription: event.target.value })} /></label>
      <label>Order fulfilment<select value={profileForm.fulfilmentMode} onChange={event => setProfileForm({ ...profileForm, fulfilmentMode: event.target.value })}>
        <option value="single_location">One location per order</option><option value="consolidate">Consolidate to one dispatch location</option><option value="split">Split by fulfilment location</option>
      </select></label>
      {profileForm.fulfilmentMode === 'consolidate' && <label>Dispatch location<select required value={profileForm.dispatchLocationId} onChange={event => setProfileForm({ ...profileForm, dispatchLocationId: event.target.value })}>
        <option value="">Choose a location</option>{fulfilmentLocations.map(location => <option value={location.id} key={location.id}>{location.name}</option>)}
      </select></label>}
    </div><div className={styles.actions}><label className={styles.uploadButton}><ImagePlus size={16} /> {working === 'upload' ? 'Uploading...' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) upload(file); event.target.value = ''; }} /></label><button className={styles.primary} disabled={Boolean(working)}><Save size={16} /> {working === 'profile' ? 'Saving...' : 'Save settings'}</button></div></form>}
    {tab === 'products' && <div className={styles.productsPanel}><div className={styles.productToolbar}><input placeholder="Search products" value={productQuery} onChange={event => setProductQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') loadProducts(); }} /><select value={productFilter} onChange={event => setProductFilter(event.target.value)}><option value="all">All products</option><option value="published">Published</option><option value="unpublished">Unpublished</option></select><button onClick={loadProducts}>Search</button></div><div className={styles.publicationList}>{products.map(product => <article key={product.product_id}><div><strong>{product.name}</strong><span>{[product.brand, product.base_sku].filter(Boolean).join(' · ') || 'No brand or base SKU'}{product.shopify_product_id ? ' · Shopify linked' : ''}</span></div><label>Store address<input value={product.slug ?? ''} disabled={product.is_published === 1} onChange={event => setProducts(current => current.map(item => item.product_id === product.product_id ? { ...item, slug: event.target.value } : item))} /></label><span className={styles.variantCount}>{Number(product.retail_variant_count)} retail {Number(product.retail_variant_count) === 1 ? 'variant' : 'variants'}</span><button className={product.is_published === 1 ? styles.unpublish : styles.publish} disabled={Boolean(working) || Number(product.retail_variant_count) < 1} onClick={() => updatePublication(product, product.is_published !== 1)}>{product.is_published === 1 ? 'Unpublish' : 'Publish'}</button></article>)}</div></div>}
    {tab === 'layout' && layout && layoutState && <div className={styles.editorLayout}><aside className={styles.templateNav}>{ONLINE_SHOP_LAYOUT_PAGE_IDS.map(id => <button data-active={template === id || undefined} key={id} onClick={() => setTemplate(id)}>{pageLabels[id]}</button>)}</aside><section className={styles.editorBody}><div className={styles.editorHeading}><div><span>Template</span><h2>{pageLabels[template]}</h2></div><div className={styles.actions}><button onClick={() => layoutAction('reset_draft')} disabled={Boolean(working)}><RotateCcw size={15} /> Reset</button><button onClick={() => layoutAction('save_draft')} disabled={!layoutDirty || Boolean(working)}><Save size={15} /> Save draft</button><button className={styles.primary} onClick={() => layoutAction('publish')} disabled={layoutDirty || Boolean(working)}><Send size={15} /> Publish</button></div></div><SectionComposer sections={layout.pages[template].sections} assets={assets}
      allowedTypes={(Object.keys(ONLINE_SHOP_LAYOUT_SECTION_REGISTRY) as OnlineShopLayoutSectionType[]).filter(type => ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type].allowedPages.includes(template))}
      requiredTypes={new Set((Object.keys(ONLINE_SHOP_LAYOUT_SECTION_REGISTRY) as OnlineShopLayoutSectionType[]).filter(type => ONLINE_SHOP_LAYOUT_SECTION_REGISTRY[type].requiredOn?.includes(template)))}
      onChange={sections => { setLayout({ ...layout, pages: { ...layout.pages, [template]: { sections: sections as OnlineShopLayoutSection[] } } }); setLayoutDirty(true); }} /><div className={styles.revision}>Draft r{layoutState.draftRevision} · Published r{layoutState.publishedRevision}{layoutDirty ? ' · Unsaved changes' : ''}</div></section></div>}
    {tab === 'pages' && <div className={styles.pagesLayout}><aside className={styles.pageSidebar}><form onSubmit={createPage}><input required placeholder="Page title" value={newPage.title} onChange={event => setNewPage({ ...newPage, title: event.target.value })} /><input required placeholder="page-address" value={newPage.slug} onChange={event => setNewPage({ ...newPage, slug: event.target.value })} /><button disabled={Boolean(working)}><FilePlus2 size={15} /> Create page</button></form><div className={styles.pageList}>{pages.map(item => <button key={item.pageId} data-active={page?.pageId === item.pageId || undefined} onClick={() => openPage(item.pageId)}><strong>{item.title}</strong><span>/{item.slug} · {item.publishedRevision ? 'Published' : 'Draft'}</span></button>)}</div></aside><section className={styles.editorBody}>{page ? <><div className={styles.pageFields}><label>Title<input value={page.title} onChange={event => { setPage({ ...page, title: event.target.value }); setPageDirty(true); }} /></label><label>Address<input value={page.slug} onChange={event => { setPage({ ...page, slug: event.target.value }); setPageDirty(true); }} /></label><label>Navigation<select value={page.navigationLocation} onChange={event => { setPage({ ...page, navigationLocation: event.target.value as any }); setPageDirty(true); }}><option value="none">Not shown</option><option value="header">Header</option><option value="footer">Footer</option><option value="both">Header and footer</option></select></label><label>Navigation label<input value={page.navigationLabel ?? ''} onChange={event => { setPage({ ...page, navigationLabel: event.target.value }); setPageDirty(true); }} /></label><label className={styles.checkbox}><input type="checkbox" checked={page.isVisible} onChange={event => { setPage({ ...page, isVisible: event.target.checked }); setPageDirty(true); }} /> Visible when published</label></div><SectionComposer sections={page.draft.sections} assets={assets} allowedTypes={ONLINE_SHOP_SHARED_SECTION_TYPES} requiredTypes={new Set()} onChange={sections => { setPage({ ...page, draft: { ...page.draft, sections: sections as OnlineShopContentPageDocument['sections'] } }); setPageDirty(true); }} /><div className={styles.actions}><button className={styles.danger} onClick={deletePage}><Trash2 size={15} /> Delete</button><button onClick={() => pageAction('reset_draft')}><RotateCcw size={15} /> Reset</button><button onClick={() => pageAction('save_draft')} disabled={!pageDirty}><Save size={15} /> Save draft</button><button className={styles.primary} onClick={() => pageAction('publish')} disabled={pageDirty}><Send size={15} /> Publish</button></div><div className={styles.revision}>Draft r{page.draftRevision} · Published r{page.publishedRevision}{pageDirty ? ' · Unsaved changes' : ''}</div></> : <div className={styles.empty}>Select a page or create a new one.</div>}</section></div>}
  </div>;
}