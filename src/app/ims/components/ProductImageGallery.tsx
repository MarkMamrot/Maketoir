'use client';
import { useEffect, useRef, useState } from 'react';
import ProductAICreativePanel from './ProductAICreativePanel';

interface ProductImage {
  id: number;
  url: string;
  source: 'shopify' | 'google_drive' | 'external';
  is_primary: number;
  sort_order: number;
  alt_text?: string;
}

interface Props {
  productId:   string;
  productName?: string;
  businessId?: string;
}

export default function ProductImageGallery({ productId, productName = 'Product', businessId = '' }: Props) {
  const [images, setImages]       = useState<ProductImage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput]   = useState('');
  const [showUrl, setShowUrl]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchImages = async () => {
    try {
      const r = await fetch(`/api/ims/products/${productId}/images`);
      const d = await r.json();
      if (d.success) setImages(d.data ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchImages(); }, [productId]);

  const primary  = images.find(i => i.is_primary) ?? images[0];
  const thumbs   = images.filter(i => i.id !== primary?.id);

  const setPrimary = async (id: number) => {
    await fetch(`/api/ims/products/${productId}/images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_primary', image_id: id }),
    });
    await fetchImages();
  };

  const deleteImage = async (id: number) => {
    await fetch(`/api/ims/products/${productId}/images?imageId=${id}`, { method: 'DELETE' });
    await fetchImages();
  };

  const uploadFile = async (file: File) => {
    if (images.length >= 8) { setError('Maximum 8 media items per product.'); return; }
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('is_primary', images.length === 0 ? '1' : '0');
      const r = await fetch(`/api/ims/products/${productId}/images/upload`, { method: 'POST', body: fd });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      await fetchImages();
    } catch (e: any) { setError(e.message); }
    setUploading(false);
  };

  const addUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    if (images.length >= 8) { setError('Maximum 8 media items per product.'); return; }
    try {
      const r = await fetch(`/api/ims/products/${productId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, source: 'external', is_primary: images.length === 0 }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.error);
      setUrlInput(''); setShowUrl(false);
      await fetchImages();
    } catch (e: any) { setError(e.message); }
  };

  const sourceLabel = (s: string) =>
    s === 'shopify' ? '🛍' : s === 'google_drive' ? '📁' : '🔗';

  if (loading) return <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', padding: '8px 0' }}>Loading images…</div>;

  return (
    <div>
      {aiPanelOpen && (
        <ProductAICreativePanel
          productId={productId}
          productName={productName}
          businessId={businessId}
          onClose={() => setAiPanelOpen(false)}
          onImageAdded={() => { fetchImages(); }}
        />
      )}
      {/* Primary image */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{
          width: 140, height: 140, flexShrink: 0,
          background: 'var(--sv-bg-2)', borderRadius: 8,
          border: '1px solid var(--sv-etch)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', position: 'relative',
        }}>
          {primary ? (
            <>
              {primary.url.match(/\.(mp4|mov|webm)$/i)
                ? <video src={primary.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} muted playsInline />
                : <img src={primary.url} alt={primary.alt_text ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              <button
                onClick={() => deleteImage(primary.id)}
                title="Remove"
                style={{
                  position: 'absolute', top: 4, right: 4,
                  background: 'rgba(0,0,0,0.55)', color: '#fff',
                  border: 'none', borderRadius: '50%', width: 22, height: 22,
                  cursor: 'pointer', fontSize: 12, lineHeight: '22px', textAlign: 'center',
                }}
              >×</button>
              <span style={{
                position: 'absolute', bottom: 4, left: 4,
                fontSize: 10, background: 'rgba(0,0,0,0.5)', color: '#fff',
                borderRadius: 4, padding: '1px 4px',
              }}>{sourceLabel(primary.source)} Primary</span>
            </>
          ) : (
            <span style={{ fontSize: 28, opacity: 0.25 }}>🖼</span>
          )}
        </div>

        {/* Thumbnails */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {thumbs.map(img => (
              <div key={img.id} style={{
                width: 64, height: 64, borderRadius: 6,
                border: '1px solid var(--sv-etch)', overflow: 'hidden',
                position: 'relative', background: 'var(--sv-bg-2)', cursor: 'pointer', flexShrink: 0,
              }}>
                <img
                  src={img.url} alt={img.alt_text ?? ''}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: img.url.match(/\.(mp4|mov|webm)$/i) ? 'none' : 'block' }}
                  onClick={() => setPrimary(img.id)}
                  title="Click to set as primary"
                />
                {img.url.match(/\.(mp4|mov|webm)$/i) && (
                  <div onClick={() => setPrimary(img.id)} title="Click to set as primary"
                    style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, cursor: 'pointer', background: 'var(--sv-bg-2)' }}>🎬</div>
                )}
                <button
                  onClick={() => deleteImage(img.id)}
                  title="Remove"
                  style={{
                    position: 'absolute', top: 2, right: 2,
                    background: 'rgba(0,0,0,0.55)', color: '#fff',
                    border: 'none', borderRadius: '50%', width: 18, height: 18,
                    cursor: 'pointer', fontSize: 10, lineHeight: '18px', textAlign: 'center',
                  }}
                >×</button>
                <span style={{
                  position: 'absolute', bottom: 2, left: 2, fontSize: 9,
                  background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 3, padding: '0 3px',
                }}>{sourceLabel(img.source)}</span>
              </div>
            ))}

            {/* Add placeholder if < 8 */}
            {images.length < 5 && (
              <div
                onClick={() => fileRef.current?.click()}
                style={{
                  width: 64, height: 64, borderRadius: 6,
                  border: '2px dashed var(--sv-etch)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1,
                  color: 'var(--sv-text-dim)', fontSize: 22,
                }}
                title="Upload image"
              >
                {uploading ? '…' : '+'}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
            <button
              onClick={() => setAiPanelOpen(true)}
              style={{
                padding: '4px 12px', fontSize: 12, border: '1px solid #8b5cf666',
                borderRadius: 5, cursor: 'pointer',
                background: 'rgba(139,92,246,.12)', color: '#a78bfa', fontWeight: 600,
              }}
            >
              ✨ AI Creative
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading || images.length >= 8}
              style={{
                padding: '4px 10px', fontSize: 12, border: '1px solid var(--sv-etch)',
                borderRadius: 5, cursor: 'pointer', background: 'var(--sv-bg-2)',
                color: 'var(--sv-text-main)',
              }}
            >
              {uploading ? 'Uploading…' : '⬆ Upload'}
            </button>
            <button
              onClick={() => setShowUrl(v => !v)}
              disabled={images.length >= 8}
              style={{
                padding: '4px 10px', fontSize: 12, border: '1px solid var(--sv-etch)',
                borderRadius: 5, cursor: 'pointer', background: 'var(--sv-bg-2)',
                color: 'var(--sv-text-main)',
              }}
            >
              🔗 Add URL
            </button>
          </div>

          {showUrl && (
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <input
                type="url" placeholder="https://…" value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUrl()}
                style={{
                  flex: 1, height: 30, padding: '0 8px', fontSize: 12,
                  border: '1px solid var(--sv-etch)', borderRadius: 5,
                  background: 'var(--sv-bg-1)', color: 'var(--sv-text-main)',
                }}
              />
              <button
                onClick={addUrl}
                style={{
                  padding: '4px 10px', fontSize: 12, border: 'none',
                  borderRadius: 5, cursor: 'pointer', background: 'var(--sv-action)',
                  color: '#fff', fontWeight: 600,
                }}
              >Add</button>
            </div>
          )}

          <div style={{ fontSize: 11, color: 'var(--sv-text-dim)' }}>
            {images.length}/5 images · click thumbnail to set primary
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#f87171' }}>✗ {error}</div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ''; }}
      />
    </div>
  );
}
