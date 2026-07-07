'use client';
/**
 * ProductAICreativePanel
 *
 * Full-screen panel opened from the product photo gallery.
 * Lets staff generate on-brand AI images/videos using:
 *   - Foresight brand asset templates (models, backdrops)
 *   - Existing product photos as reference
 *   - AI chat for prompt refinement (same pattern as BrandAssetsView)
 *   - Nano Banana for images, Veo for videos
 *
 * Generated media is added to the product (Shopify-synced if connected).
 */

import { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface BrandAsset { id: number; category: string; name: string; content: string; image_data?: string | null; image_mime?: string | null }
interface ProductImage { id: number; url: string; is_primary: number }
interface RefImage     { data: string; mimeType: string; label: string; thumbnail: string }
type ChatMsg = { role: 'user' | 'assistant'; text: string }

const LS_IMAGE_MODEL = 'pos_ai_creative_img_model';
const LS_VIDEO_MODEL    = 'pos_ai_creative_vid_model';
const LS_TEXT_MODEL     = 'pos_ai_creative_txt_model';
const LS_ASPECT_RATIO   = 'pos_ai_creative_aspect_ratio';

const ASPECT_RATIOS = [
  { value: '1:1',  label: '1:1 Square' },
  { value: '3:4',  label: '3:4 Portrait' },
  { value: '4:5',  label: '4:5 Portrait' },
  { value: '9:16', label: '9:16 Story / Reel' },
  { value: '4:3',  label: '4:3 Landscape' },
  { value: '16:9', label: '16:9 Wide' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
async function urlToBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = res.headers.get('content-type') ?? 'image/jpeg';
    const buf  = await res.arrayBuffer();
    const b64  = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return { data: b64, mimeType: mime };
  } catch { return null; }
}

// ── Model picker hook ─────────────────────────────────────────────────────────
function useModelPicker(lsKey: string, defaultVal: string) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(lsKey) ?? defaultVal; } catch { return defaultVal; }
  });
  const set = (v: string) => { setValue(v); try { localStorage.setItem(lsKey, v); } catch {} };
  return [value, set] as const;
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  productId:        string;
  productName:      string;
  businessId:       string;
  onClose:          () => void;
  onImageAdded:     () => void;
}

export default function ProductAICreativePanel({ productId, productName, businessId, onClose, onImageAdded }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [tab, setTab]                   = useState<'image' | 'video' | 'text'>('image');
  const [assets, setAssets]             = useState<BrandAsset[]>([]);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [selectedRefs, setSelectedRefs] = useState<RefImage[]>([]);
  const [chatMsgs, setChatMsgs]         = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const [chatLoading, setChatLoading]   = useState(false);
  const [chatError, setChatError]       = useState('');
  const [generatedImage, setGeneratedImage] = useState<{ data: string; mimeType: string } | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<{ data?: string; uri?: string; mimeType: string } | null>(null);
  const [generatedText, setGeneratedText] = useState<{ title?: string; description?: string; tags?: string[]; imagePrompt?: string } | null>(null);
  const [generating, setGenerating]     = useState(false);
  const [genError, setGenError]         = useState('');
  const [saving, setSaving]             = useState(false);
  const [savingText, setSavingText]     = useState(false);
  const [savedTextFields, setSavedTextFields] = useState<Set<string>>(new Set());
  const [freshCreativesExpanded, setFreshCreativesExpanded] = useState(false);
  const [includeExistingText, setIncludeExistingText] = useState(true);
  const [savedUrl, setSavedUrl]         = useState<string | null>(null);
  const [imageModels, setImageModels]   = useState<{ id: string; displayName: string }[]>([]);
  const [imageModel, setImageModel]     = useModelPicker(LS_IMAGE_MODEL, 'gemini-3.1-flash-image');
  const [videoModel, setVideoModel]     = useModelPicker(LS_VIDEO_MODEL, 'veo-3.1-generate-preview');
  const [textModel,  setTextModel]      = useModelPicker(LS_TEXT_MODEL,  'gemini-2.5-flash');
  const [aspectRatio, setAspectRatio]   = useModelPicker(LS_ASPECT_RATIO, '1:1');
  const [videoModels]                   = useState([
    { id: 'veo-3.1-generate-preview',      displayName: 'Veo 3.1 (Preview)' },
    { id: 'veo-3.1-lite-generate-preview', displayName: 'Veo 3.1 Lite (Preview)' },
  ]);
  const [includeBrandProfile, setIncludeBrandProfile] = useState(true);
  const [includeBusinessInfo, setIncludeBusinessInfo] = useState(true);
  const [loadingRefs, setLoadingRefs]   = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Load data ───────────────────────────────────────────────────────────────
  useEffect(() => {
    // Brand assets
    fetch(`/api/dashboard/brand-assets`)
      .then(r => r.json())
      .then(d => setAssets(d.assets ?? []))
      .catch(() => {});
    // Product images
    fetch(`/api/ims/products/${productId}/images`)
      .then(r => r.json())
      .then(d => setProductImages(d.data ?? []))
      .catch(() => {});
    // Image models
    fetch('/api/ai/image-models')
      .then(r => r.json())
      .then(d => { if (d.models?.length) setImageModels(d.models); })
      .catch(() => {});
  }, [productId]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMsgs, chatLoading]);

  // ── Ref image helpers ───────────────────────────────────────────────────────
  const addRefFromAsset = useCallback(async (asset: BrandAsset) => {
    setLoadingRefs(asset.name);
    try {
      let data = asset.image_data;
      let mime = asset.image_mime ?? 'image/jpeg';
      if (!data && asset.content) {
        // No saved image — skip (user should generate one first in Brand Assets)
        setLoadingRefs(null);
        return;
      }
      if (data) {
        setSelectedRefs(p => {
          // Toggle: deselect if already selected
          if (p.some(r => r.label === asset.name)) return p.filter(r => r.label !== asset.name);
          return [...p, { data, mimeType: mime, label: asset.name, thumbnail: `data:${mime};base64,${data}` }];
        });
      }
    } finally { setLoadingRefs(null); }
  }, []);

  const addRefFromProductImage = useCallback(async (img: ProductImage) => {
    setLoadingRefs(String(img.id));
    try {
      // Fetch server-side to avoid CORS issues with Shopify/CDN URLs
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'fetch-ref-image', url: img.url }),
      });
      const d = await res.json();
      if (d.success && d.data) {
        setSelectedRefs(p => {
          // Toggle: deselect if already selected
          if (p.some(r => r.label === `Product #${img.id}`)) return p.filter(r => r.label !== `Product #${img.id}`);
          return [...p, { data: d.data, mimeType: d.mimeType, label: `Product #${img.id}`, thumbnail: img.url }];
        });
      }
    } finally { setLoadingRefs(null); }
  }, [productId]);

  const removeRef = (label: string) => setSelectedRefs(p => p.filter(r => r.label !== label));

  // ── Chat ────────────────────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const msg = chatInput.trim();
    setChatInput(''); setChatError('');
    const newMsgs: ChatMsg[] = [...chatMsgs, { role: 'user', text: msg }];
    setChatMsgs(newMsgs);
    setChatLoading(true);
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'chat', prompt: msg,
          referenceImages: selectedRefs.map(r => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
          includeBrandProfile, includeBusinessInfo,
          history: newMsgs.slice(0, -1).map(m => ({ role: m.role, content: m.text })),
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? 'Chat error');
      setChatMsgs(p => [...p, { role: 'assistant', text: d.response }]);
    } catch (e: any) { setChatError(e.message); }
    setChatLoading(false);
  };

  // ── Generate (handles image / video / text) ──────────────────────────────
  const generate = async (directPrompt?: string) => {
    const lastAI = [...chatMsgs].reverse().find(m => m.role === 'assistant');
    const promptToUse = directPrompt ?? lastAI?.text ?? '';

    if (tab === 'text') {
      // Text generation: uses product images + brand context, no prompt required
      setGenerating(true); setGenError(''); setGeneratedText(null);
      try {
        const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'text',
            referenceImages: selectedRefs.map(r => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
            textModel,
            includeExistingText,
            existingTitle: (window as any).__aiProductTitle ?? '',
            existingDescription: (window as any).__aiProductDesc ?? '',
            existingTags: (window as any).__aiProductTags ?? '',
            includeBrandProfile: true, includeBusinessInfo: true,
          }),
        });
        const d = await res.json();
        if (!res.ok || !d.success) throw new Error(d.error ?? 'Text generation failed');
        setGeneratedText({ title: d.title, description: d.description, tags: d.tags, imagePrompt: d.imagePrompt });
      } catch (e: any) { setGenError(e.message); }
      setGenerating(false);
      return;
    }

    if (!promptToUse) { setGenError('Select references and use Quick Improve or write a prompt first.'); return; }
    setGenerating(true); setGenError(''); setGeneratedImage(null); setGeneratedVideo(null); setSavedUrl(null);

    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: tab,
          prompt: promptToUse,
          imageModel, videoModel, aspectRatio,
          referenceImages: selectedRefs.map(r => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error ?? `${tab} generation failed`);
      if (tab === 'image') setGeneratedImage({ data: d.imageData, mimeType: d.mimeType });
      else setGeneratedVideo({ data: d.videoData, uri: d.videoUri, mimeType: d.mimeType });
    } catch (e: any) { setGenError(e.message); }
    setGenerating(false);
  };

  // ── Save text field to product ─────────────────────────────────────────────
  const saveTextField = async (field: 'title' | 'description' | 'tags' | 'all') => {
    if (!generatedText) return;
    setSavingText(true);
    const payload: any = {};
    if (field === 'title' || field === 'all')       payload.title       = generatedText.title;
    if (field === 'description' || field === 'all') payload.description = generatedText.description;
    if (field === 'tags' || field === 'all')        payload.tags        = generatedText.tags;
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'save-text', ...payload }),
      });
      const d = await res.json();
      if (d.success) {
        setSavedTextFields(p => new Set([...p, field]));
        setTimeout(() => setSavedTextFields(p => { const n = new Set(p); n.delete(field); return n; }), 3000);
      }
    } catch {}
    setSavingText(false);
  };

  // ── Quick Improve: build compositing prompt and go straight to image ───────
  const quickImprove = async () => {
    if (selectedRefs.length === 0) { setGenError('Select at least one reference image first.'); return; }
    const productRefs  = selectedRefs.filter(r => r.label.startsWith('Product'));
    const templateRefs = selectedRefs.filter(r => !r.label.startsWith('Product'));
    const userExtra    = chatInput.trim();
    const templates    = templateRefs.map(r => r.label).join(', ');

    const autoPrompt = [
      productRefs.length > 0
        ? `Composite the provided product image with the provided template reference${templateRefs.length > 0 ? ` (${templates})` : ''}.`
        : `Create an on-brand product image using the provided template reference${templates ? ` (${templates})` : ''}.`,
      templateRefs.some(r => r.label.toLowerCase().includes('model') || r.label.toLowerCase().includes('Model'))
        ? `If the product is wearable (clothing, accessory, jewellery), show the model from the reference wearing or holding it naturally at correct scale and proportion. Match the lighting from the template.`
        : ``,
      templateRefs.some(r => r.label.toLowerCase().includes('backdrop') || r.label.toLowerCase().includes('Backdrop'))
        ? `Place the product from the product reference within the backdrop scene in a visually compelling, natural position. Match the lighting, shadows, and perspective of the scene.`
        : ``,
      `Maintain photographic realism throughout: accurate product colours, textures and scale. Do not alter or invent the product or model — both are provided in the reference images.`,
      `Produce a clean, premium, on-brand result suitable for product photography.`,
      userExtra ? `Additional instruction: ${userExtra}` : ``,
    ].filter(Boolean).join(' ');

    setChatInput('');
    await generate(autoPrompt);
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const save = async () => {
    const media = tab === 'image' ? generatedImage : generatedVideo;
    if (!media) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'save',
          mediaData: media.data,
          mediaType: media.mimeType,
          isVideo: tab === 'video',
          altText: `AI creative — ${productName}`,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error ?? 'Save failed');
      setSavedUrl(d.url);
      onImageAdded();
    } catch (e: any) { setGenError(e.message); }
    setSaving(false);
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const bg0 = 'var(--sv-bg-0,#0f172a)';
  const bg1 = 'var(--sv-bg-1,#1e293b)';
  const bg2 = 'var(--sv-bg-2,#334155)';
  const etch = 'var(--sv-etch,rgba(255,255,255,.1))';
  const textMain = 'var(--sv-text-main,#e2e8f0)';
  const textDim  = 'var(--sv-text-dim,#94a3b8)';
  const action   = 'var(--sv-action,#3b82f6)';
  const mint     = 'var(--sv-mint,#22c55e)';
  const red      = 'var(--sv-red,#ef4444)';

  const panelBtn = (active?: boolean, danger?: boolean): React.CSSProperties => ({
    padding: '6px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    background: danger ? '#ef4444' : active ? action : bg2,
    color: active || danger ? '#fff' : textDim,
  });

  const toggleStyle = (on: boolean, color: string): React.CSSProperties => ({
    fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 20, cursor: 'pointer',
    border: `1px solid ${on ? color : etch}`,
    background: on ? color + '20' : 'transparent',
    color: on ? color : textDim,
  });

  const modelLabels = imageModels.length > 0 ? imageModels : [
    { id: 'gemini-3.1-flash-image', displayName: 'Nano Banana 2' },
    { id: 'gemini-3-pro-image', displayName: 'Nano Banana Pro' },
  ];

  const assetModels    = assets.filter(a => a.category === 'models');
  const assetBackdrops = assets.filter(a => a.category === 'backdrops');

  return (
    <div style={{ position: 'fixed', inset: 0, background: bg0, zIndex: 2000, display: 'flex', flexDirection: 'column', fontFamily: 'system-ui,sans-serif', color: textMain }}>

      {/* ── Topbar ── */}
      <div style={{ height: 50, background: bg1, borderBottom: `1px solid ${etch}`, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12, flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: textDim, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' }}>←</button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>✨ AI Creative Studio</span>
        <span style={{ fontSize: 12, color: textDim }}>— {productName}</span>
        <div style={{ flex: 1 }} />
        {/* Image/Video tabs */}
        {(['image', 'video', 'text'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setGenError(''); }} style={{ ...panelBtn(tab === t), textTransform: 'capitalize' }}>
            {t === 'image' ? '🖼️ Image' : t === 'video' ? '🎬 Video' : '📝 Text Content'}
          </button>
        ))}
      </div>

      {/* ── Body: 3 columns ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 0 }}>

        {/* ── LEFT: Template & photo picker ── */}
        <div style={{ width: 380, background: bg1, borderRight: `1px solid ${etch}`, overflow: 'auto', padding: '12px 12px 16px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Selected refs strip */}
          {selectedRefs.length > 0 && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: .6, margin: '0 0 7px' }}>✓ Selected ({selectedRefs.length})</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {selectedRefs.map(r => (
                  <div key={r.label} title={r.label}
                    style={{ position: 'relative', width: 56, cursor: 'pointer' }}
                    onClick={() => removeRef(r.label)}>
                    <img src={r.thumbnail} alt={r.label}
                      style={{ width: 56, height: 74, objectFit: 'cover', borderRadius: 6, border: `2px solid #22c55e`, display: 'block' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity .15s' }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                      <span style={{ color: '#ef4444', fontSize: 18, fontWeight: 700 }}>×</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Helper component for a portrait-grid template section */}
          {(['models', 'backdrops'] as const).map(cat => {
            const catAssets = cat === 'models' ? assetModels : assetBackdrops;
            if (catAssets.length === 0) return null;
            const accentColor = cat === 'models' ? '#0ea5e9' : '#8b5cf6';
            const icon = cat === 'models' ? '👤' : '🌅';
            const label = cat === 'models' ? 'Model Templates' : 'Backdrop Templates';
            return (
              <div key={cat}>
                <p style={{ fontSize: 10, fontWeight: 700, color: accentColor, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 8px' }}>{label}</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {catAssets.map(a => {
                    const sel = selectedRefs.some(r => r.label === a.name);
                    const loading = loadingRefs === a.name;
                    return (
                      <div key={a.id} onClick={() => !loading && addRefFromAsset(a)} title={a.name}
                        style={{ position: 'relative', cursor: loading ? 'wait' : 'pointer', borderRadius: 8, overflow: 'hidden',
                          border: `2px solid ${sel ? accentColor : 'transparent'}`,
                          boxShadow: sel ? `0 0 0 1px ${accentColor}` : 'none' }}>
                        <div style={{ aspectRatio: '3/4', background: bg2, overflow: 'hidden' }}>
                          {a.image_data ? (
                            <img src={`data:${a.image_mime ?? 'image/jpeg'};base64,${a.image_data}`}
                              alt={a.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>{icon}</div>
                          )}
                          {loading && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff' }}>Loading…</div>
                          )}
                          {sel && (
                            <div style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, background: accentColor, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700 }}>✓</div>
                          )}
                          {!a.image_data && (
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.6)', padding: '3px 5px', fontSize: 9, color: '#fbbf24' }}>No image yet</div>
                          )}
                        </div>
                        <div style={{ fontSize: 10, color: sel ? accentColor : textDim, padding: '4px 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: sel ? 700 : 400 }}>{a.name}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {assetModels.length === 0 && assetBackdrops.length === 0 && (
            <p style={{ fontSize: 12, color: textDim, lineHeight: 1.6, margin: 0 }}>No brand asset templates yet. Create models and backdrops in <strong>Foresight → Brand Assets</strong> first.</p>
          )}

          {/* Existing product photos */}
          {productImages.length > 0 && (
            <div>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: .5, margin: '14px 0 6px' }}>Product Photos</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {productImages.map(img => {
                  const sel = selectedRefs.some(r => r.label === `Product #${img.id}`);
                  return (
                    <div key={img.id} onClick={() => addRefFromProductImage(img)}
                      style={{ position: 'relative', cursor: 'pointer' }}>
                      <img src={img.url} alt="Product"
                        style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: `2px solid ${sel ? '#f59e0b' : etch}`, opacity: loadingRefs === String(img.id) ? .5 : 1 }} />
                      {sel && <div style={{ position: 'absolute', top: 2, right: 2, background: '#f59e0b', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff' }}>✓</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── CENTRE: AI Chat (narrower) ── */}
        <div style={{ flex: '1 1 auto', minWidth: 280, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          {/* Context toggles */}
          <div style={{ background: bg1, borderBottom: `1px solid ${etch}`, padding: '8px 14px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
            <button style={toggleStyle(includeBrandProfile, '#8b5cf6')} onClick={() => setIncludeBrandProfile(p => !p)}>{includeBrandProfile ? '✓ ' : ''}Brand Profile</button>
            <button style={toggleStyle(includeBusinessInfo,  '#0ea5e9')} onClick={() => setIncludeBusinessInfo(p => !p)} >{includeBusinessInfo  ? '✓ ' : ''}Business Info</button>
            <button style={toggleStyle(includeExistingText,  '#f59e0b')} onClick={() => setIncludeExistingText(p => !p)}>{includeExistingText  ? '✓ ' : ''}Existing Title/Desc/Tags</button>
            {selectedRefs.length > 0 && <span style={{ fontSize: 11, color: '#22c55e' }}>📎 {selectedRefs.length} reference{selectedRefs.length !== 1 ? 's' : ''} attached</span>}
          </div>

          {/* Quick Improve bar */}
          {selectedRefs.length > 0 && chatMsgs.length === 0 && (
            <div style={{ background: `rgba(139,92,246,.1)`, borderBottom: `1px solid rgba(139,92,246,.25)`, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span style={{ fontSize: 12, color: '#a78bfa', flex: 1 }}>References selected — use Quick Improve or write your own prompt below</span>
              <button
                onClick={quickImprove}
                disabled={generating || selectedRefs.length === 0}
                style={{ ...panelBtn(true), fontSize: 12, padding: '5px 12px', background: '#8b5cf6', whiteSpace: 'nowrap', opacity: (generating || selectedRefs.length === 0) ? .5 : 1 }}
              >
                {generating ? '⏳ Generating…' : '⚡ Quick Improve → Image'}
              </button>
            </div>
          )}

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {chatMsgs.length === 0 && (
              <div style={{ textAlign: 'center', padding: selectedRefs.length > 0 ? '24px 20px' : '40px 20px', color: textDim }}>
                <p style={{ fontSize: 22, margin: '0 0 12px' }}>✨</p>
                <p style={{ fontSize: 14, margin: '0 0 8px', color: textMain }}>AI Product Creative Studio</p>
                {selectedRefs.length === 0 ? (
                  <p style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>
                    <strong style={{ color: textMain }}>Step 1:</strong> Select your product photo from the left panel (add it as a reference).<br />
                    <strong style={{ color: textMain }}>Step 2:</strong> Add a model or backdrop template.<br />
                    <strong style={{ color: textMain }}>Step 3:</strong> Hit <strong style={{ color: '#8b5cf6' }}>⚡ Quick Improve</strong> or write your own prompt.
                  </p>
                ) : (
                  <p style={{ fontSize: 13, margin: 0, lineHeight: 1.7, color: textDim }}>
                    References ready. Use <strong style={{ color: '#8b5cf6' }}>⚡ Quick Improve</strong> above for an auto-generated compositing prompt,<br />
                    or write your own below to customise.
                  </p>
                )}
              </div>
            )}
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '85%', borderRadius: 12, padding: '10px 14px',
                  background: m.role === 'user' ? action : bg2,
                  color: '#fff', fontSize: 13, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, opacity: .7, marginBottom: 5 }}>
                    {m.role === 'user' ? 'You' : 'AI Creative Director'}
                  </div>
                  {m.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display: 'flex' }}>
                <div style={{ borderRadius: 12, padding: '10px 14px', background: bg2, color: textDim, fontSize: 13 }}>Writing prompt…</div>
              </div>
            )}
            {chatError && <p style={{ fontSize: 12, color: red, background: '#ef444415', padding: '6px 10px', borderRadius: 6, margin: 0 }}>⚠️ {chatError}</p>}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${etch}`, flexShrink: 0 }}>
            <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder={selectedRefs.length > 0 ? 'Optional: add extra instructions (e.g. outdoor setting, golden light) then Quick Improve, or write a full prompt and Make Prompt' : 'Describe the creative you need — the AI will write a detailed generation prompt'}
              rows={2}
              style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 9, border: `1px solid ${etch}`, background: bg2, color: textMain, resize: 'none', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' as const }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 7 }}>
              <button onClick={quickImprove}
                disabled={generating || selectedRefs.length === 0}
                style={{ ...panelBtn(true), flex: 1, padding: '7px', background: '#8b5cf6', fontSize: 12, opacity: (generating || selectedRefs.length === 0) ? .4 : 1 }}>
                {generating ? '⏳ Generating…' : '⚡ Quick Improve → Image'}
              </button>
              <button onClick={sendChat}
                disabled={!chatInput.trim() || chatLoading}
                style={{ ...panelBtn(chatLoading ? false : !!chatInput.trim()), flex: 1, padding: '7px', fontSize: 12, opacity: chatInput.trim() && !chatLoading ? 1 : .4 }}>
                {chatLoading ? 'Writing…' : '✍ Make Detailed Prompt'}
              </button>
            </div>
            <p style={{ fontSize: 10, color: textDim, margin: '5px 0 0' }}>⚡ Quick Improve uses your text as extra context and generates the image immediately · ✍ Make Prompt refines with AI first</p>
          </div>
        </div>

        {/* ── RIGHT: Fresh Creatives (wider, expandable) ── */}
        <div style={{ flex: freshCreativesExpanded ? '1 1 auto' : '0 0 380px', background: bg1, borderLeft: `1px solid ${etch}`, display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'auto', transition: 'flex .2s' }}>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .6, margin: 0 }}>✨ Fresh Creatives</p>
              <button onClick={() => setFreshCreativesExpanded(p => !p)}
                style={{ background: 'none', border: `1px solid ${etch}`, borderRadius: 5, cursor: 'pointer', fontSize: 11, color: textDim, padding: '2px 8px' }}>
                {freshCreativesExpanded ? '⊙ Shrink' : '⊞ Expand'}
              </button>
            </div>

            {/* ── Text Content tab ── */}
            {tab === 'text' && (
              <div>
                <p style={{ fontSize: 11, color: textDim, marginBottom: 10, lineHeight: 1.6 }}>
                  Select product photos and/or enable <strong>Existing Title/Desc/Tags</strong> (in the context bar) as references. The AI analyses them with your brand context.
                </p>
                {(() => { const hasProductRef = selectedRefs.filter(r => r.label.startsWith('Product')).length > 0; const canGenerate = hasProductRef || includeExistingText; return (
                <>
                <button onClick={() => generate()}
                  disabled={generating || !canGenerate}
                  style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer', background: '#f59e0b', color: '#fff', fontWeight: 700, fontSize: 14,
                    opacity: generating || !canGenerate ? .4 : 1, marginBottom: 8 }}>
                  {generating ? 'Generating text\u2026' : '\ud83d\udcdd Generate Title, Description & Tags'}
                </button>
                {!canGenerate && (
                  <p style={{ fontSize: 11, color: textDim, marginBottom: 8 }}>Select a product photo or enable Existing Title/Desc/Tags in the context bar above.</p>
                )}
                </>) })()}
                {/* Text model selector */}
                <div style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 5px' }}>Text Model</p>
                  <select value={textModel} onChange={e => setTextModel(e.target.value)}
                    style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid ${etch}`, background: bg2, color: textMain, fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
                    <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                    <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                  </select>
                </div>
                {genError && <p style={{ fontSize: 11, color: red, background: '#ef444415', padding: '6px 8px', borderRadius: 6 }}>\u26a0\ufe0f {genError}</p>}
                {generatedText && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {generatedText.title && (
                      <div style={{ background: bg2, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: .5 }}>Title</span>
                          <button onClick={() => saveTextField('title')} disabled={savingText} style={{ ...panelBtn(true), fontSize: 10, padding: '2px 8px', background: savedTextFields.has('title') ? '#22c55e' : action }}>{savedTextFields.has('title') ? '\u2713 Saved' : '+ Apply'}</button>
                        </div>
                        <p style={{ fontSize: 13, color: textMain, margin: 0, fontWeight: 600 }}>{generatedText.title}</p>
                      </div>
                    )}
                    {generatedText.tags && (
                      <div style={{ background: bg2, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: .5 }}>Tags</span>
                          <button onClick={() => saveTextField('tags')} disabled={savingText} style={{ ...panelBtn(true), fontSize: 10, padding: '2px 8px', background: savedTextFields.has('tags') ? '#22c55e' : action }}>{savedTextFields.has('tags') ? '\u2713 Saved' : '+ Apply'}</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {(generatedText.tags ?? []).map((t, i) => <span key={i} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(139,92,246,.2)', color: '#c4b5fd' }}>{t}</span>)}
                        </div>
                      </div>
                    )}
                    {generatedText.description && (
                      <div style={{ background: bg2, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: .5 }}>Description</span>
                          <button onClick={() => saveTextField('description')} disabled={savingText} style={{ ...panelBtn(true), fontSize: 10, padding: '2px 8px', background: savedTextFields.has('description') ? '#22c55e' : action }}>{savedTextFields.has('description') ? '\u2713 Saved' : '+ Apply'}</button>
                        </div>
                        <div style={{ fontSize: 12, color: textMain, maxHeight: 200, overflow: 'auto', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: generatedText.description }} />
                      </div>
                    )}
                    {generatedText.imagePrompt && (
                      <div style={{ background: bg2, borderRadius: 8, padding: '10px 12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5 }}>Suggested Image Prompt</span>
                          <button onClick={() => { setTab('image'); setGenError(''); }} style={{ ...panelBtn(false), fontSize: 10, padding: '2px 8px' }}>\u2192 Generate Image</button>
                        </div>
                        <p style={{ fontSize: 11, color: textDim, margin: 0, fontFamily: 'monospace', lineHeight: 1.5 }}>{generatedText.imagePrompt}</p>
                      </div>
                    )}
                    <button onClick={() => saveTextField('all')} disabled={savingText} style={{ ...panelBtn(true), width: '100%', padding: '8px', background: '#22c55e', fontSize: 13 }}>
                      {savedTextFields.has('all') ? '\u2713 All Saved to Product' : '\u2705 Apply All to Product'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Image / Video generation ── */}
            {tab !== 'text' && (
            <div>
            {/* Model selector */}
            <div style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 5px' }}>
                {tab === 'image' ? 'Image Model' : 'Video Model'}
              </p>
              <select value={tab === 'image' ? imageModel : videoModel}
                onChange={e => tab === 'image' ? setImageModel(e.target.value) : setVideoModel(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: `1px solid ${etch}`, background: bg2, color: textMain, fontSize: 12, cursor: 'pointer', outline: 'none' }}>
                {(tab === 'image' ? modelLabels : videoModels).map(m => (
                  <option key={m.id} value={m.id}>{m.displayName}</option>
                ))}
              </select>
            </div>

            {/* Aspect ratio selector */}
            {tab === 'image' && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 5px' }}>Aspect Ratio</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {ASPECT_RATIOS.map(ar => (
                    <button key={ar.value} onClick={() => setAspectRatio(ar.value)}
                      style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${aspectRatio === ar.value ? action : etch}`, background: aspectRatio === ar.value ? action + '25' : 'transparent', color: aspectRatio === ar.value ? action : textDim, fontSize: 11, cursor: 'pointer', fontWeight: aspectRatio === ar.value ? 700 : 400 }}>
                      {ar.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Requires prompt */}
            {chatMsgs.filter(m => m.role === 'assistant').length === 0 && (
              <p style={{ fontSize: 12, color: textDim, marginBottom: 12 }}>← Use ⚡ Quick Improve or generate a prompt in the chat, then click Generate.</p>
            )}

            {/* Generate button */}
            <button onClick={() => generate()}
              disabled={generating || chatMsgs.filter(m => m.role === 'assistant').length === 0}
              style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer', background: action, color: '#fff', fontWeight: 700, fontSize: 14, opacity: generating || chatMsgs.filter(m => m.role === 'assistant').length === 0 ? .4 : 1, marginBottom: 6 }}>
              {generating ? (tab === 'image' ? 'Generating image…' : 'Generating video… (may take 30–60s)') : `Generate ${tab === 'image' ? 'Image' : 'Video'}`}
            </button>

            {genError && <p style={{ fontSize: 11, color: red, background: '#ef444415', padding: '6px 8px', borderRadius: 6, marginBottom: 8 }}>⚠️ {genError}</p>}

            {/* Preview */}
            {generatedImage && tab === 'image' && (
              <div style={{ marginTop: 10 }}>
                <img src={`data:${generatedImage.mimeType};base64,${generatedImage.data}`} alt="Generated"
                  style={{ width: '100%', borderRadius: 10, border: `1px solid ${etch}`, display: 'block' }} />
                {savedUrl ? (
                  <p style={{ fontSize: 11, color: '#22c55e', marginTop: 8, textAlign: 'center' }}>✓ Added to product</p>
                ) : (
                  <button onClick={save} disabled={saving}
                    style={{ ...panelBtn(true), width: '100%', marginTop: 8, padding: '8px', fontSize: 13, opacity: saving ? .6 : 1 }}>
                    {saving ? 'Saving…' : '+ Add to Product'}
                  </button>
                )}
                <button onClick={() => {
                  const a = document.createElement('a');
                  a.href = `data:${generatedImage.mimeType};base64,${generatedImage.data}`;
                  a.download = `ai-creative-${Date.now()}.jpg`; a.click();
                }} style={{ ...panelBtn(false), width: '100%', marginTop: 6, padding: '6px', fontSize: 12 }}>⤓ Download</button>
              </div>
            )}

            {generatedVideo && tab === 'video' && (
              <div style={{ marginTop: 10 }}>
                {generatedVideo.data
                  ? <video src={`data:${generatedVideo.mimeType};base64,${generatedVideo.data}`} controls style={{ width: '100%', borderRadius: 10, border: `1px solid ${etch}` }} />
                  : generatedVideo.uri
                    ? <p style={{ fontSize: 12, color: textDim, padding: '12px 0', textAlign: 'center' }}>Video ready: <a href={generatedVideo.uri} target="_blank" rel="noopener noreferrer" style={{ color: action }}>Open video →</a></p>
                    : null}
                {!savedUrl && (
                  <button onClick={save} disabled={saving}
                    style={{ ...panelBtn(true), width: '100%', marginTop: 8, padding: '8px', fontSize: 13, opacity: saving ? .6 : 1 }}>
                    {saving ? 'Saving…' : '+ Add to Product'}
                  </button>
                )}
                {savedUrl && <p style={{ fontSize: 11, color: '#22c55e', marginTop: 8, textAlign: 'center' }}>✓ Added to product</p>}
              </div>
            )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
