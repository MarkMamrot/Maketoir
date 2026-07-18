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

// Parse a fetch Response as JSON, but degrade gracefully when the server returns
// an HTML error page (e.g. a 502/504 gateway timeout) instead of JSON. Prevents
// the "Unexpected token '<', <!DOCTYPE..." crash and surfaces a clean message.
async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const looksHtml = /^\s*</.test(text);
    if (res.status === 504 || res.status === 502 || res.status === 408) {
      throw new Error('The request timed out. Try a faster text model (e.g. Gemini 2.5 Flash) or fewer reference images.');
    }
    throw new Error(
      looksHtml
        ? `Server error (HTTP ${res.status}). Try a faster text model or try again.`
        : (text.slice(0, 160) || `Request failed (HTTP ${res.status}).`),
    );
  }
}

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

// ── AI Quick Instruction Presets ─────────────────────────────────────────────
const AI_CREATIVE_PRESETS = [
  { id: 'whiteBg',       label: 'Clean White Background',           promptText: 'Use a perfectly clean, pure white studio background — no shadows, gradients, textures or props.' },
  { id: 'varyBg',        label: 'Vary Backdrop for Product/Brand',  promptText: 'Choose a backdrop and background that naturally complements this specific product and the brand aesthetic.' },
  { id: 'varyPose',      label: 'Vary Model Pose for Product',      promptText: '(If a model is present) Choose a natural, flattering pose that best showcases this product — it need not match any reference pose.' },
  { id: 'varyOutfit',    label: 'Vary Model Outfit for Brand',      promptText: '(If a model is present) Style the model in an on-brand outfit that complements this product — do not copy the clothing from any reference image.' },
  { id: 'varyModel',     label: 'Vary Model to Suit Brand',         promptText: '(If a model is present) Use a model whose appearance and styling represents the target demographic of this brand.' },
  { id: 'studioLight',   label: 'Professional Studio Lighting',     promptText: 'Apply professional studio lighting: softbox diffused light, flattering highlights, clean minimal shadows.' },
  { id: 'goldenHour',    label: 'Golden Hour / Warm Natural Light', promptText: 'Use warm golden-hour natural sunlight — soft, directional, flattering warmth.' },
  { id: 'lifestyle',     label: 'Lifestyle / In-Use Shot',          promptText: 'Show the product being worn or used naturally in a real-world context, not a staged studio shot.' },
  { id: 'flatLay',       label: 'Flat Lay / Top-Down',              promptText: 'Compose as an overhead flat-lay shot — product centred on a clean surface, top-down perspective, minimal props.' },
  { id: 'noModel',       label: 'Product Only (No Model)',          promptText: 'Show the product only — no model, no person, no mannequin. Product-focus composition.' },
  { id: 'brandColours',  label: 'Incorporate Brand Colours',        promptText: "Prominently incorporate the brand's colour palette in the backdrop, props or styling." },
  { id: 'editorial',     label: 'Editorial / Magazine Style',       promptText: 'Compose in a high-fashion editorial style — dynamic, aspirational, suitable for a premium lifestyle magazine.' },
  { id: 'varyExpression',label: 'Vary Model Expression',            promptText: '(If a model is present) Give the model a fresh, natural facial expression that differs subtly from any reference — e.g. a soft genuine smile or relaxed warm look.' },
  { id: 'varyGaze',      label: 'Vary Model Gaze / Head Angle',     promptText: '(If a model is present) Introduce a subtle variation to the model head tilt and gaze — a gentle off-camera glance or slight head turn, keeping it flattering.' },
];

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  productId:        string;
  productName:      string;
  businessId:       string;
  productTitle?:       string;
  productDescription?: string;
  productTags?:        string;
  onApplyText?:     (fields: { title?: string; description?: string; tags?: string }) => void;
  onClose:          () => void;
  onImageAdded:     () => void;
}

export default function ProductAICreativePanel({ productId, productName, businessId, productTitle = '', productDescription = '', productTags = '', onApplyText, onClose, onImageAdded }: Props) {
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
  const [promptPreview, setPromptPreview] = useState<any | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [savedUrl, setSavedUrl]         = useState<string | null>(null);
  const [imageModels, setImageModels]   = useState<{ id: string; displayName: string }[]>([]);
  const [textModels,  setTextModels]    = useState<{ id: string; displayName: string }[]>([]);
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
  const [includeWebTemplates, setIncludeWebTemplates] = useState(true);
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [showMakePrompt, setShowMakePrompt] = useState(false);
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<string, boolean>>({ models: true, backdrops: true, poses: true, scenes: true, productPhotos: true, otherProduct: false });
  const [selectedPresets, setSelectedPresets]   = useState<Set<string>>(new Set());
  const [otherProductQuery, setOtherProductQuery] = useState('');
  const [otherProductResults, setOtherProductResults] = useState<{ product_id: string; name: string }[]>([]);
  const [otherProductImages, setOtherProductImages]   = useState<Record<string, Array<{ id: number; url: string; is_primary: number; _productName: string }>>>({});
  const [otherProductOpen, setOtherProductOpen] = useState(false);
  const uploadRefInputRef = useRef<HTMLInputElement>(null);
  const [similarQuery, setSimilarQuery]     = useState('');
  const [similarResults, setSimilarResults] = useState<{ product_id: string; name: string }[]>([]);
  const [selectedSimilar, setSelectedSimilar] = useState<{ product_id: string; name: string }[]>([]);
  const [similarBrand, setSimilarBrand]     = useState('');
  const [similarOpen, setSimilarOpen]       = useState(false);
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
    // Text models
    fetch('/api/ai/text-models')
      .then(r => r.json())
      .then(d => { if (d.models?.length) setTextModels(d.models); })
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

  const addRefFromProductImage = useCallback(async (img: ProductImage, label: string) => {
    setLoadingRefs(String(img.id));
    try {
      // Fetch server-side to avoid CORS issues with Shopify/CDN URLs
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'fetch-ref-image', url: img.url }),
      });
      const d = await parseJsonResponse(res);
      if (d.success && d.data) {
        setSelectedRefs(p => {
          // Toggle: deselect if already selected
          if (p.some(r => r.label === label)) return p.filter(r => r.label !== label);
          return [...p, { data: d.data, mimeType: d.mimeType, label, thumbnail: img.url }];
        });
      }
    } finally { setLoadingRefs(null); }
  }, [productId]);

  // ── Upload a reference photo from disk ────────────────────────────────────────────
  const handleUploadRef = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      const comma = result.indexOf(',');
      const data = result.slice(comma + 1);
      const mimeType = result.slice(5, comma).replace(';base64', '');
      const suffix = file.name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14) || String(Date.now());
      const label = `UPLOADPhoto-${suffix}`;
      setSelectedRefs(p => {
        if (p.some(r => r.label === label)) return p;
        return [...p, { data, mimeType, label, thumbnail: result }];
      });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  // ── Search other products (for OTHERPRODUCT refs) ─────────────────────────────────
  const searchOtherProducts = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'search-products', query: q }),
      });
      const d = await parseJsonResponse(res);
      if (d.success) setOtherProductResults(d.products ?? []);
    } catch {}
  }, [productId]);

  const loadOtherProductImages = useCallback(async (pid: string, pname: string) => {
    setLoadingRefs(`OTHERPRODUCT-${pid}`);
    try {
      const res = await fetch(`/api/ims/products/${pid}/images`);
      const d = await res.json();
      if (d.data?.length) {
        setOtherProductImages(prev => ({ ...prev, [pid]: d.data.map((img: any) => ({ ...img, _productName: pname })) }));
      }
    } catch {}
    setLoadingRefs(null);
  }, []);

  const addRefFromOtherProductImage = useCallback(async (imgUrl: string, productName: string) => {
    const safeName = productName.replace(/[^a-zA-Z0-9]/g, '').slice(0, 14);
    const label = `OTHERPRODUCT-${safeName}`;
    setLoadingRefs(label);
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'fetch-ref-image', url: imgUrl }),
      });
      const d = await parseJsonResponse(res);
      if (d.success && d.data) {
        setSelectedRefs(p => {
          if (p.some(r => r.label === label)) return p.filter(r => r.label !== label);
          return [...p, { data: d.data, mimeType: d.mimeType, label, thumbnail: imgUrl }];
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
      const d = await parseJsonResponse(res);
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
            includeWebTemplates,
            additionalInstructions: buildCombinedInstructions(),
            similarProductIds: selectedSimilar.map(s => s.product_id),
            existingTitle: productTitle,
            existingDescription: productDescription,
            existingTags: productTags,
            includeBrandProfile, includeBusinessInfo,
          }),
        });
        const d = await parseJsonResponse(res);
        if (!res.ok || !d.success) throw new Error(d.error ?? 'Text generation failed');
        const safeTags = Array.isArray(d.tags)
          ? d.tags
          : typeof d.tags === 'string'
            ? d.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
            : [];
        setGeneratedText({ title: d.title, description: d.description, tags: safeTags, imagePrompt: d.imagePrompt });
        setFreshCreativesExpanded(true);
        if (!d.title && !d.description && !d.imagePrompt && safeTags.length === 0) {
          setGenError('AI returned no content. Try a different model or add a product photo.');
        }
      } catch (e: any) { setGenError(e.message); }
      setGenerating(false);
      return;
    }

    // Image / video generation. Prompt priority:
    //  1. a manually-refined prompt (from "Make detailed prompt")
    //  2. otherwise an auto compositing prompt built from the selected references
    // Brand context, additional instructions and similar products are added server-side.
    const basePrompt = promptToUse || buildAutoPrompt();
    if (!basePrompt.trim()) { setGenError('Select references (or write a prompt) first.'); return; }
    setGenerating(true); setGenError(''); setGeneratedImage(null); setGeneratedVideo(null); setSavedUrl(null);

    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: tab,
          prompt: basePrompt,
          imageModel, videoModel, aspectRatio,
          additionalInstructions: buildCombinedInstructions(),
          similarProductIds: selectedSimilar.map(s => s.product_id),
          includeBrandProfile, includeBusinessInfo,
          referenceImages: selectedRefs.map(r => ({ data: r.data, mimeType: r.mimeType, label: r.label })),
        }),
      });
      const d = await parseJsonResponse(res);
      if (!res.ok || !d.success) throw new Error(d.error ?? `${tab} generation failed`);
      if (tab === 'image') setGeneratedImage({ data: d.imageData, mimeType: d.mimeType });
      else setGeneratedVideo({ data: d.videoData, uri: d.videoUri, mimeType: d.mimeType });
    } catch (e: any) { setGenError(e.message); }
    setGenerating(false);
  };

  // ── Similar products search (same brand, type-to-filter) ───────────────────
  const searchSimilar = useCallback(async (q: string) => {
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'search-products', query: q }),
      });
      const d = await parseJsonResponse(res);
      if (d.success) { setSimilarResults(d.products ?? []); setSimilarBrand(d.brand ?? ''); }
    } catch {}
  }, [productId]);

  useEffect(() => {
    if (!similarOpen) return;
    const t = setTimeout(() => searchSimilar(similarQuery), 250);
    return () => clearTimeout(t);
  }, [similarQuery, similarOpen, searchSimilar]);

  // Clear a stale prompt preview when switching creative type
  useEffect(() => { setPromptPreview(null); setShowPromptPreview(false); }, [tab]);

  // Other-product search debounce
  useEffect(() => {
    if (!otherProductOpen) return;
    const t = setTimeout(() => searchOtherProducts(otherProductQuery), 250);
    return () => clearTimeout(t);
  }, [otherProductQuery, otherProductOpen, searchOtherProducts]);

  const toggleSimilar = (p: { product_id: string; name: string }) => {
    setSelectedSimilar(prev => prev.some(x => x.product_id === p.product_id)
      ? prev.filter(x => x.product_id !== p.product_id)
      : [...prev, p]);
  };

  // ── Fetch the assembled prompt (preview without generating) ─────────────────
  const fetchPromptPreview = async () => {
    setLoadingPreview(true);
    try {
      const similarProductIds = selectedSimilar.map(s => s.product_id);
      const body: any = tab === 'text'
        ? {
            mode: 'text', previewOnly: true, textModel,
            referenceImages: selectedRefs.map(r => ({ mimeType: r.mimeType, label: r.label })),
            includeExistingText, includeWebTemplates, additionalInstructions: buildCombinedInstructions(),
            existingTitle: productTitle, existingDescription: productDescription, existingTags: productTags,
            includeBrandProfile, includeBusinessInfo, similarProductIds,
          }
        : {
            mode: tab, previewOnly: true,
            prompt: ([...chatMsgs].reverse().find(m => m.role === 'assistant')?.text) || buildAutoPrompt(),
            imageModel, videoModel, aspectRatio,
            referenceImages: selectedRefs.map(r => ({ mimeType: r.mimeType, label: r.label })),
            includeBrandProfile, includeBusinessInfo, additionalInstructions: buildCombinedInstructions(), similarProductIds,
          };
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await parseJsonResponse(res);
      if (d.success && d.preview) setPromptPreview(d.preview);
    } catch {}
    setLoadingPreview(false);
  };

  // ── Save text field to product ─────────────────────────────────────────────
  const saveTextField = async (field: 'title' | 'description' | 'tags' | 'all') => {
    if (!generatedText) return;
    setSavingText(true);
    const payload: any = {};
    // Only include NON-EMPTY fields so we never overwrite/delete existing content with blanks.
    if ((field === 'title' || field === 'all')       && generatedText.title?.trim())        payload.title       = generatedText.title;
    if ((field === 'description' || field === 'all') && generatedText.description?.trim())  payload.description = generatedText.description;
    if ((field === 'tags' || field === 'all')        && Array.isArray(generatedText.tags) && generatedText.tags.length) payload.tags = generatedText.tags;
    if (Object.keys(payload).length === 0) {
      setGenError('Nothing to apply — the AI did not return content for that field.');
      setSavingText(false);
      return;
    }
    // Update the product edit form so the user sees the change and a later form
    // save won't overwrite it with stale values.
    if (onApplyText) {
      onApplyText({
        ...(payload.title       !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.tags        !== undefined ? { tags: Array.isArray(payload.tags) ? payload.tags.join(', ') : payload.tags } : {}),
      });
    }
    try {
      const res = await fetch(`/api/ims/products/${productId}/ai-creative`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'save-text', ...payload }),
      });
      const d = await parseJsonResponse(res);
      if (d.success) {
        setSavedTextFields(p => new Set([...p, field]));
        setTimeout(() => setSavedTextFields(p => { const n = new Set(p); n.delete(field); return n; }), 3000);
      }
    } catch {}
    setSavingText(false);
  };

  // ── Build an auto compositing prompt from the selected references ──────────
  const buildAutoPrompt = (): string => {
    const productRefs      = selectedRefs.filter(r => r.label.startsWith('Product-') || r.label.startsWith('Product #') || r.label.startsWith('Product '));
    const modelRefs        = selectedRefs.filter(r => r.label.startsWith('Model-') || (!r.label.startsWith('Product') && !r.label.startsWith('Backdrop-') && !r.label.startsWith('Pose-') && !r.label.startsWith('Scene-') && !r.label.startsWith('OTHERPRODUCT-') && !r.label.startsWith('UPLOADPhoto-') && r.label.toLowerCase().includes('model')));
    const backdropRefs     = selectedRefs.filter(r => r.label.startsWith('Backdrop-') || (!r.label.startsWith('Product') && !r.label.startsWith('Model-') && !r.label.startsWith('Pose-') && !r.label.startsWith('Scene-') && !r.label.startsWith('OTHERPRODUCT-') && !r.label.startsWith('UPLOADPhoto-') && r.label.toLowerCase().includes('backdrop')));
    const poseRefs         = selectedRefs.filter(r => r.label.startsWith('Pose-'));
    const sceneRefs        = selectedRefs.filter(r => r.label.startsWith('Scene-'));
    const otherProductRefs = selectedRefs.filter(r => r.label.startsWith('OTHERPRODUCT-'));
    const uploadPhotoRefs  = selectedRefs.filter(r => r.label.startsWith('UPLOADPhoto-'));

    const hasProduct  = productRefs.length > 0;
    const hasModel    = modelRefs.length > 0;
    const hasBackdrop = backdropRefs.length > 0;
    const hasPose     = poseRefs.length > 0;
    const hasScene    = sceneRefs.length > 0;
    const hasOther    = otherProductRefs.length > 0;
    const hasUpload   = uploadPhotoRefs.length > 0;

    const productLabel  = productRefs.map(r => r.label).join(', ');
    const modelLabel    = modelRefs.map(r => r.label).join(', ');
    const backdropLabel = backdropRefs.map(r => r.label).join(', ');
    const poseLabel     = poseRefs.map(r => r.label).join(', ');
    const sceneLabel    = sceneRefs.map(r => r.label).join(', ');
    const otherLabel    = otherProductRefs.map(r => r.label).join(', ');
    const uploadLabel   = uploadPhotoRefs.map(r => r.label).join(', ');

    const parts: string[] = [];

    if (hasProduct) {
      parts.push(`PRODUCT reference(s) [${productLabel}]: These images contain the ACTUAL product that must appear in the output — reproduce it exactly with its real design, colours, textures, graphics, logo and shape completely unchanged.`);
      parts.push(`CRITICAL: Take the product ONLY from the PRODUCT reference(s). NEVER keep, copy or import any product, garment or item shown in any other reference image.`);
    }

    if (hasModel) {
      parts.push(`MODEL reference [${modelLabel}]: Use this person's exact face, body, skin tone and identity.${hasProduct ? ` Dress the model in the product from the PRODUCT reference — NOT the clothing from the MODEL reference. Fit it naturally with correct scale, drape and proportion.` : ` Feature this model in an on-brand composition.`}`);
    }

    if (hasPose) {
      parts.push(`POSE reference [${poseLabel}]: ${hasModel ? `The model MUST adopt this specific pose — reproduce the stance, limb positions and body angle from this reference while maintaining the model's identity.` : `Any person in the image should be shown in this specific pose.`}`);
    }

    if (hasScene) {
      parts.push(`SCENE reference [${sceneLabel}]: Set the composition within this type of scene/environment — match its mood, atmosphere and environmental context.`);
    }

    if (hasBackdrop) {
      parts.push(`BACKDROP reference [${backdropLabel}]: ${hasProduct ? `Place the product from the PRODUCT reference on/within this backdrop in a natural, compelling position` : `Use this as the background/backdrop`}. Match the backdrop's lighting, shadows and perspective. Do NOT import any products or objects from the backdrop reference.`);
    }

    if (hasOther && hasProduct) {
      parts.push(`OTHER PRODUCT reference [${otherLabel}]: Use this as a style and presentation guide. Present the product from the PRODUCT reference in a similar creative style, framing and context — but show ONLY the PRODUCT reference product.`);
    } else if (hasOther) {
      parts.push(`OTHER PRODUCT reference [${otherLabel}]: Match the creative style, framing, composition and presentation approach shown in this reference.`);
    }

    if (hasUpload && hasProduct) {
      parts.push(`UPLOADED reference [${uploadLabel}]: Use this uploaded image as the primary creative/style reference. Present the product from the PRODUCT reference in a similar way — same setting, framing and presentation style.`);
    } else if (hasUpload) {
      parts.push(`UPLOADED reference [${uploadLabel}]: Use this as the creative brief — match its style, setting, composition and mood.`);
    }

    if (hasModel && selectedPresets.has('varyExpression')) {
      parts.push(`Give the model a fresh, natural facial expression that differs subtly from the reference (e.g. a soft genuine smile or relaxed warm look) while keeping the SAME person's identity, features and skin exactly.`);
    }

    if (hasModel && selectedPresets.has('varyGaze')) {
      parts.push(`Introduce a subtle, natural variation to the model's head tilt and gaze — a gentle off-camera glance or slight head turn. Keep it flattering, never a full turn or profile.`);
    }

    if (parts.length === 0) {
      return `Create a clean, premium, on-brand product image suitable for professional product photography.`;
    }

    parts.push(`Maintain photographic realism throughout: accurate lighting, shadows and perspective. Produce a clean, premium, on-brand result suitable for product photography.`);
    return parts.filter(Boolean).join(' ');
  };

  // ── Combine preset + free-text instructions for server ────────────────────
  const buildCombinedInstructions = (): string => {
    const presetTexts = AI_CREATIVE_PRESETS
      .filter(p => selectedPresets.has(p.id))
      .map(p => `• ${p.promptText}`);
    const freeText = additionalInstructions.trim();
    if (!presetTexts.length && !freeText) return '';
    const parts: string[] = [];
    if (presetTexts.length) parts.push(presetTexts.join('\n'));
    if (freeText) parts.push(`USER OVERRIDE — Apply these specific instructions above all other defaults: ${freeText}`);
    return parts.join('\n\n');
  };

  // ── Quick Improve: build compositing prompt and go straight to image ───────
  const quickImprove = async () => {
    if (selectedRefs.length === 0) { setGenError('Select at least one reference image first.'); return; }
    setChatInput('');
    await generate(buildAutoPrompt());
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
      const d = await parseJsonResponse(res);
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
  const assetPoses     = assets.filter(a => a.category === 'poses');
  const assetScenes    = assets.filter(a => a.category === 'scenes');

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

      {/* ── Body: 2 equal columns ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: 0 }}>

        {/* ── LEFT: Template & photo picker ── */}
        <div style={{ flex: 1, background: bg1, borderRight: `1px solid ${etch}`, overflow: 'auto', padding: '12px 12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

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

          {/* Upload ref (hidden input) */}
          <input type="file" ref={uploadRefInputRef} accept="image/*" style={{ display: 'none' }} onChange={handleUploadRef} />

          {/* Upload button */}
          <button
            onClick={() => uploadRefInputRef.current?.click()}
            title="Upload an image from your computer as a reference photo. It will be labelled UPLOADPhoto-filename and the AI will use it as a creative/style reference for the output."
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '6px 11px', borderRadius: 7, background: bg2, border: `1px solid ${etch}`, color: textDim, cursor: 'pointer', width: '100%' }}>
            📎 <span>Upload Reference Photo</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: textDim }}>UPLOADPhoto-xxx</span>
          </button>

          {/* Brand asset sections (collapsible) */}
          {([
            { key: 'models',    label: 'Models',    color: '#0ea5e9', icon: '👤', catAssets: assetModels,    tooltip: 'Model reference photos (Model-Name). AI uses this person\'s exact face/body. If a product ref is selected, the model will wear it.' },
            { key: 'backdrops', label: 'Backdrops', color: '#8b5cf6', icon: '🌅', catAssets: assetBackdrops, tooltip: 'Background references (Backdrop-Name). The product will be placed on/within this backdrop.' },
            { key: 'poses',     label: 'Poses',     color: '#f97316', icon: '🤸', catAssets: assetPoses,     tooltip: 'Pose references (Pose-Name). If a model is selected, they will adopt this specific pose and stance.' },
            { key: 'scenes',    label: 'Scenes',    color: '#10b981', icon: '🏙️', catAssets: assetScenes,    tooltip: 'Scene/environment references (Scene-Name). Sets the environmental context and mood for the creative.' },
          ] as const).map(({ key, label, color, icon, catAssets, tooltip }) => {
            if (catAssets.length === 0) return null;
            const expanded = sectionsExpanded[key] !== false;
            return (
              <div key={key}>
                <button
                  onClick={() => setSectionsExpanded(p => ({ ...p, [key]: !expanded }))}
                  title={tooltip}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: .5 }}>
                  <span style={{ fontSize: 13 }}>{icon}</span>
                  <span style={{ flex: 1, textAlign: 'left' as const }}>{label} ({catAssets.length})</span>
                  <span style={{ color: textDim, fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
                  <span title={tooltip} style={{ color: textDim, fontSize: 11, cursor: 'help', marginLeft: 2 }}>ⓘ</span>
                </button>
                {expanded && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 6 }}>
                    {catAssets.map(a => {
                      const sel = selectedRefs.some(r => r.label === a.name);
                      const loading = loadingRefs === a.name;
                      return (
                        <div key={a.id} onClick={() => !loading && addRefFromAsset(a)} title={`${a.name} — click to select`}
                          style={{ position: 'relative', cursor: loading ? 'wait' : 'pointer', borderRadius: 8, overflow: 'hidden',
                            border: `2px solid ${sel ? color : 'transparent'}`,
                            boxShadow: sel ? `0 0 0 1px ${color}` : 'none' }}>
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
                              <div style={{ position: 'absolute', top: 5, right: 5, width: 20, height: 20, background: color, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700 }}>✓</div>
                            )}
                            {!a.image_data && (
                              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,.6)', padding: '3px 5px', fontSize: 9, color: '#fbbf24' }}>No image yet</div>
                            )}
                          </div>
                          <div style={{ fontSize: 9, color: sel ? color : textDim, padding: '3px 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, fontWeight: sel ? 700 : 400 }}>{a.name}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {assetModels.length === 0 && assetBackdrops.length === 0 && assetPoses.length === 0 && assetScenes.length === 0 && (
            <p style={{ fontSize: 12, color: textDim, lineHeight: 1.6, margin: 0 }}>No brand assets yet. Create <strong>Models</strong>, <strong>Backdrops</strong>, <strong>Poses</strong> and <strong>Scenes</strong> in <strong>Foresight → Brand Assets</strong> first. Name them <em>Model-Name</em>, <em>Backdrop-Name</em>, <em>Pose-Name</em>, <em>Scene-Name</em>.</p>
          )}

          {/* Product Photos (collapsible) */}
          {productImages.length > 0 && (
            <div>
              <button
                onClick={() => setSectionsExpanded(p => ({ ...p, productPhotos: p.productPhotos === false }))}
                title="Your product's existing photos. Select to use as the PRODUCT reference — AI will reproduce this exact product in the output. Labelled Product-1, Product-2 etc."
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', color: '#f59e0b', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: .5, marginTop: 2 }}>
                <span style={{ fontSize: 13 }}>🏷️</span>
                <span style={{ flex: 1, textAlign: 'left' as const }}>Product Photos ({productImages.length})</span>
                <span style={{ color: textDim, fontSize: 11 }}>{sectionsExpanded.productPhotos !== false ? '▾' : '▸'}</span>
                <span title="Select a product photo to use as PRODUCT reference. AI will reproduce this exact product in the output." style={{ color: textDim, fontSize: 11, cursor: 'help', marginLeft: 2 }}>ⓘ</span>
              </button>
              {sectionsExpanded.productPhotos !== false && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {productImages.map((img, idx) => {
                    const label = `Product-${idx + 1}`;
                    const sel = selectedRefs.some(r => r.label === label);
                    return (
                      <div key={img.id} onClick={() => addRefFromProductImage(img, label)}
                        title={`${label} — click to select as product reference`}
                        style={{ position: 'relative', cursor: 'pointer' }}>
                        <img src={img.url} alt={label}
                          style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 6, border: `2px solid ${sel ? '#f59e0b' : etch}`, opacity: loadingRefs === String(img.id) ? .5 : 1 }} />
                        {sel && <div style={{ position: 'absolute', top: 2, right: 2, background: '#f59e0b', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff' }}>✓</div>}
                        <div style={{ fontSize: 9, color: sel ? '#f59e0b' : textDim, textAlign: 'center' as const, marginTop: 2 }}>{label}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Other Product Reference (collapsible) */}
          <div>
            <button
              onClick={() => setSectionsExpanded(p => ({ ...p, otherProduct: !p.otherProduct }))}
              title="Search another product from your catalogue and pick one of its photos as a creative reference. Labelled OTHERPRODUCT-name. Great for matching the style/presentation of an existing successful product photo."
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', color: '#0ea5e9', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: .5, marginTop: 2 }}>
              <span style={{ fontSize: 13 }}>🔗</span>
              <span style={{ flex: 1, textAlign: 'left' as const }}>Other Product Reference {selectedRefs.some(r => r.label.startsWith('OTHERPRODUCT-')) ? '✓' : ''}</span>
              <span style={{ color: textDim, fontSize: 11 }}>{sectionsExpanded.otherProduct ? '▾' : '▸'}</span>
              <span title="Pick a photo from another product to use as a style reference (OTHERPRODUCT-name prefix)." style={{ color: textDim, fontSize: 11, cursor: 'help', marginLeft: 2 }}>ⓘ</span>
            </button>
            {sectionsExpanded.otherProduct && (
              <div style={{ marginTop: 6 }}>
                <p style={{ fontSize: 10, color: textDim, margin: '0 0 5px', lineHeight: 1.5 }}>Search your catalogue and click a product, then pick one of its photos as a creative reference (OTHERPRODUCT-xxx).</p>
                <input
                  value={otherProductQuery}
                  onFocus={() => { setOtherProductOpen(true); if (otherProductResults.length === 0) searchOtherProducts(''); }}
                  onChange={e => { setOtherProductQuery(e.target.value); setOtherProductOpen(true); }}
                  placeholder="Search products…"
                  style={{ width: '100%', fontSize: 11, padding: '6px 9px', borderRadius: 7, border: `1px solid ${etch}`, background: bg2, color: textMain, outline: 'none', boxSizing: 'border-box' as const }}
                />
                {otherProductOpen && otherProductResults.length > 0 && (
                  <div style={{ marginTop: 3, background: bg0, border: `1px solid ${etch}`, borderRadius: 8, maxHeight: 160, overflow: 'auto' }}>
                    {otherProductResults.map(p => (
                      <div key={p.product_id}
                        onClick={() => { loadOtherProductImages(p.product_id, p.name); setOtherProductOpen(false); }}
                        style={{ padding: '5px 9px', fontSize: 11, cursor: 'pointer', color: textMain, borderBottom: `1px solid ${etch}` }}
                        onMouseEnter={e => (e.currentTarget.style.background = bg2)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                        {p.name}
                      </div>
                    ))}
                  </div>
                )}
                {otherProductOpen && (
                  <button onClick={() => setOtherProductOpen(false)} style={{ ...panelBtn(false), fontSize: 10, padding: '3px 8px', marginTop: 4 }}>Close</button>
                )}
                {Object.entries(otherProductImages).map(([pid, imgs]) => (
                  <div key={pid} style={{ marginTop: 8 }}>
                    <p style={{ fontSize: 10, color: '#0ea5e9', margin: '0 0 4px', fontWeight: 700 }}>{imgs[0]?._productName ?? pid} — select photo:</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {imgs.map((img: any) => {
                        const safeLabel = `OTHERPRODUCT-${(img._productName ?? pid).replace(/[^a-zA-Z0-9]/g, '').slice(0, 14)}`;
                        const sel = selectedRefs.some(r => r.label === safeLabel);
                        return (
                          <div key={img.id}
                            onClick={() => !loadingRefs && addRefFromOtherProductImage(img.url, img._productName ?? pid)}
                            title={`Add as ${safeLabel}`}
                            style={{ position: 'relative', cursor: loadingRefs === safeLabel ? 'wait' : 'pointer' }}>
                            <img src={img.url} alt="Product photo"
                              style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 6, border: `2px solid ${sel ? '#0ea5e9' : etch}`, opacity: loadingRefs === safeLabel ? .5 : 1 }} />
                            {sel && <div style={{ position: 'absolute', top: 2, right: 2, background: '#0ea5e9', borderRadius: '50%', width: 13, height: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff' }}>✓</div>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Fresh Creatives (equal width) ── */}
        <div style={{ flex: 1, background: bg1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ padding: 14 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .6, margin: '0 0 10px' }}>✨ Fresh Creatives</p>

            {/* Context selectors */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${etch}` }}>
              <button style={toggleStyle(includeBrandProfile, '#8b5cf6')} onClick={() => setIncludeBrandProfile(p => !p)}>{includeBrandProfile ? '✓ ' : ''}Brand Profile</button>
              <button style={toggleStyle(includeBusinessInfo,  '#0ea5e9')} onClick={() => setIncludeBusinessInfo(p => !p)} >{includeBusinessInfo  ? '✓ ' : ''}Business Info</button>
              <button style={toggleStyle(includeExistingText,  '#f59e0b')} onClick={() => setIncludeExistingText(p => !p)}>{includeExistingText  ? '✓ ' : ''}Existing Title/Desc/Tags</button>
              <button style={toggleStyle(includeWebTemplates,  '#10b981')} onClick={() => setIncludeWebTemplates(p => !p)}>{includeWebTemplates  ? '✓ ' : ''}Website Templates</button>
              {selectedRefs.length > 0 && <span style={{ fontSize: 11, color: '#22c55e' }}>📎 {selectedRefs.length} reference{selectedRefs.length !== 1 ? 's' : ''} attached</span>}
            </div>

            {/* AI Quick Instructions — preset checkboxes */}
            {tab !== 'text' && (
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 7px' }}>
                  ⚡ Quick AI Instructions
                  <span title="Tick instructions to include them in every generation. Additional Instructions (below) override all of these." style={{ marginLeft: 5, cursor: 'help', color: textDim }}>ⓘ</span>
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {AI_CREATIVE_PRESETS.map(preset => {
                    const on = selectedPresets.has(preset.id);
                    return (
                      <button key={preset.id} title={preset.promptText}
                        onClick={() => setSelectedPresets(p => { const n = new Set(p); if (n.has(preset.id)) n.delete(preset.id); else n.add(preset.id); return n; })}
                        style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 20, cursor: 'pointer',
                          border: `1px solid ${on ? '#22c55e' : etch}`,
                          background: on ? '#22c55e20' : 'transparent',
                          color: on ? '#22c55e' : textDim }}>
                        {on ? '✓ ' : ''}{preset.label}
                      </button>
                    );
                  })}
                </div>
                {selectedPresets.size > 0 && (
                  <button onClick={() => setSelectedPresets(new Set())} style={{ fontSize: 10, color: textDim, background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginTop: 4 }}>✕ Clear all</button>
                )}
              </div>
            )}

            {/* Additional instructions — always shown, overrides everything */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 5px' }}>
                Additional Instructions for AI
                <span title="Your free-text instructions here OVERRIDE all Quick Instructions and all auto-generated prompt defaults. Use this for specific requirements that take full control." style={{ marginLeft: 5, cursor: 'help', color: textDim }}>ⓘ</span>
              </p>
              <textarea value={additionalInstructions} onChange={e => setAdditionalInstructions(e.target.value)}
                placeholder={tab === 'text' ? 'e.g. emphasise sustainability, mention it ships gift-wrapped… (overrides all other instructions)' : 'e.g. specific shot requirements… These override all Quick Instructions above.'}
                rows={2}
                style={{ width: '100%', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `1px solid ${etch}`, background: bg2, color: textMain, resize: 'vertical', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' as const }} />
            </div>

            {/* Similar products (same brand) — searchable multi-select */}
            <div style={{ marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 5px' }}>
                Similar Products {similarBrand ? `· ${similarBrand}` : ''} {selectedSimilar.length > 0 ? `(${selectedSimilar.length} selected)` : ''}
              </p>
              {selectedSimilar.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 6 }}>
                  {selectedSimilar.map(s => (
                    <span key={s.product_id} onClick={() => toggleSimilar(s)}
                      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 99, background: 'rgba(14,165,233,.2)', color: '#7dd3fc', cursor: 'pointer' }} title="Remove">
                      {s.name} ×
                    </span>
                  ))}
                </div>
              )}
              <input value={similarQuery}
                onFocus={() => { setSimilarOpen(true); if (similarResults.length === 0) searchSimilar(''); }}
                onChange={e => { setSimilarQuery(e.target.value); setSimilarOpen(true); }}
                placeholder="Search same-brand products to match style…"
                style={{ width: '100%', fontSize: 12, padding: '7px 10px', borderRadius: 8, border: `1px solid ${etch}`, background: bg2, color: textMain, outline: 'none', boxSizing: 'border-box' as const }} />
              {similarOpen && similarResults.length > 0 && (
                <div style={{ marginTop: 4, background: bg0, border: `1px solid ${etch}`, borderRadius: 8, maxHeight: 180, overflow: 'auto' }}>
                  {similarResults.map(p => {
                    const sel = selectedSimilar.some(x => x.product_id === p.product_id);
                    return (
                      <div key={p.product_id} onClick={() => toggleSimilar(p)}
                        style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: sel ? '#7dd3fc' : textMain, background: sel ? 'rgba(14,165,233,.12)' : 'transparent', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        <span style={{ flexShrink: 0 }}>{sel ? '✓' : '+'}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {similarOpen && (
                <button onClick={() => setSimilarOpen(false)} style={{ ...panelBtn(false), fontSize: 10, padding: '3px 8px', marginTop: 4 }}>Close list</button>
              )}
            </div>

            {/* Prompt preview — all modes */}
            <div style={{ marginBottom: 12 }}>
              <button onClick={() => { const next = !showPromptPreview; setShowPromptPreview(next); if (next) fetchPromptPreview(); }}
                style={{ width: '100%', textAlign: 'left', background: bg2, border: `1px solid ${etch}`, borderRadius: 7, padding: '7px 10px', cursor: 'pointer', color: textDim, fontSize: 11, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>🔍 Preview full prompt {promptPreview?.templatesIncluded ? '· ✓ brand templates' : ''}</span>
                <span>{showPromptPreview ? '▾' : '▸'}</span>
              </button>
              {showPromptPreview && (
                <div style={{ marginTop: 8, background: bg0, border: `1px solid ${etch}`, borderRadius: 7, padding: '10px 12px', maxHeight: 320, overflow: 'auto' }}>
                  {loadingPreview && <p style={{ fontSize: 11, color: textDim, margin: 0 }}>Loading…</p>}
                  {promptPreview && (
                    <>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 4px' }}>Model</p>
                      <p style={{ fontSize: 11, color: textMain, margin: '0 0 10px', fontFamily: 'monospace' }}>{promptPreview.model}</p>
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 4px' }}>Reference Images ({promptPreview.referenceImages?.length ?? 0})</p>
                      <p style={{ fontSize: 11, color: textDim, margin: '0 0 10px' }}>{promptPreview.referenceImages?.length ? promptPreview.referenceImages.join(', ') : 'None selected'}</p>
                      {promptPreview.userMessage && (
                        <>
                          <p style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 4px' }}>Generation Prompt</p>
                          <pre style={{ fontSize: 10, color: textMain, margin: '0 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: 1.5 }}>{promptPreview.userMessage}</pre>
                        </>
                      )}
                      <p style={{ fontSize: 9, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 4px' }}>Brand Context {tab === 'text' ? (promptPreview.templatesIncluded ? '(includes website templates ✓)' : '(no templates found)') : ''}</p>
                      <pre style={{ fontSize: 10, color: textMain, margin: '0 0 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: 1.5 }}>{promptPreview.contextBlock || '(empty)'}</pre>
                      <p style={{ fontSize: 9, fontWeight: 700, color: textDim, textTransform: 'uppercase', letterSpacing: .5, margin: '0 0 4px' }}>System Instruction</p>
                      <pre style={{ fontSize: 10, color: textDim, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', lineHeight: 1.5 }}>{promptPreview.systemPrompt}</pre>
                    </>
                  )}
                  <button onClick={fetchPromptPreview} style={{ ...panelBtn(false), fontSize: 10, padding: '4px 10px', marginTop: 8 }}>↻ Refresh preview</button>
                </div>
              )}
            </div>

            {/* Make detailed prompt — optional dropdown, image/video only */}
            {tab !== 'text' && (
              <div style={{ marginBottom: 12 }}>
                <button onClick={() => setShowMakePrompt(p => !p)}
                  style={{ width: '100%', textAlign: 'left', background: bg2, border: `1px solid ${etch}`, borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: textDim, fontSize: 11, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>✍ Make detailed prompt (optional){chatMsgs.some(m => m.role === 'assistant') ? ' · ✓ prompt ready' : ''}</span>
                  <span>{showMakePrompt ? '▾' : '▸'}</span>
                </button>
                {showMakePrompt && (
                  <div style={{ marginTop: 8, background: bg0, border: `1px solid ${etch}`, borderRadius: 8, padding: 10 }}>
                    <p style={{ fontSize: 11, color: textDim, margin: '0 0 8px', lineHeight: 1.5 }}>
                      Describe the shot and let the AI craft a full generation prompt. If you make one, it becomes the prompt used (together with your selected context and additional instructions).
                    </p>
                    <textarea value={chatInput} onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                      placeholder="Describe the creative you need…"
                      rows={2}
                      style={{ width: '100%', fontSize: 12, padding: '8px 10px', borderRadius: 8, border: `1px solid ${etch}`, background: bg2, color: textMain, resize: 'vertical', outline: 'none', lineHeight: 1.5, boxSizing: 'border-box' as const }} />
                    <button onClick={sendChat} disabled={!chatInput.trim() || chatLoading}
                      style={{ ...panelBtn(!!chatInput.trim() && !chatLoading), width: '100%', marginTop: 7, padding: '7px', fontSize: 12, opacity: chatInput.trim() && !chatLoading ? 1 : .4 }}>
                      {chatLoading ? 'Writing…' : '✍ Make Detailed Prompt'}
                    </button>
                    {chatError && <p style={{ fontSize: 11, color: red, margin: '6px 0 0' }}>⚠️ {chatError}</p>}
                    {chatMsgs.filter(m => m.role === 'assistant').slice(-1).map((m, i) => (
                      <div key={i} style={{ marginTop: 8, background: bg2, borderRadius: 8, padding: '8px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: action, textTransform: 'uppercase', letterSpacing: .5 }}>Generated prompt (will be used)</span>
                          <button onClick={() => setChatMsgs([])} style={{ background: 'none', border: 'none', color: textDim, cursor: 'pointer', fontSize: 11 }}>Clear</button>
                        </div>
                        <p style={{ fontSize: 11, color: textMain, margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.text}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Text Content tab ── */}
            {tab === 'text' && (
              <div>
                <p style={{ fontSize: 11, color: textDim, marginBottom: 10, lineHeight: 1.6 }}>
                  Select product photos and/or enable <strong>Existing Title/Desc/Tags</strong> above. The AI analyses them with your brand context and website templates.
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
                    {(textModels.length > 0 ? textModels : [
                      { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
                      { id: 'gemini-2.5-pro',   displayName: 'Gemini 2.5 Pro' },
                      { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
                    ]).map(m => (
                      <option key={m.id} value={m.id}>{m.displayName}</option>
                    ))}
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
                    {Array.isArray(generatedText.tags) && generatedText.tags.length > 0 && (
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

            {/* Requires references or a prompt */}
            {selectedRefs.length === 0 && chatMsgs.filter(m => m.role === 'assistant').length === 0 && (
              <p style={{ fontSize: 12, color: textDim, marginBottom: 12 }}>Select references on the left (and optionally make a detailed prompt) to generate.</p>
            )}

            {/* Generate button */}
            <button onClick={() => generate()}
              disabled={generating || (selectedRefs.length === 0 && chatMsgs.filter(m => m.role === 'assistant').length === 0)}
              style={{ width: '100%', padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer', background: action, color: '#fff', fontWeight: 700, fontSize: 14, opacity: generating || (selectedRefs.length === 0 && chatMsgs.filter(m => m.role === 'assistant').length === 0) ? .4 : 1, marginBottom: 6 }}>
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
