'use client';
import { useEffect, useRef, useState } from 'react';
import ProductAICreativePanel from './ProductAICreativePanel';

interface ProductImage {
  id: number;
  url: string;
  source: 'shopify' | 'google_drive' | 'external' | 'volume';
  drive_file_id?: string | null;
  is_primary: number;
  sort_order: number;
  alt_text?: string;
}

interface Props {
  productId:   string;
  productName?: string;
  businessId?: string;
  productTitle?: string;
  productDescription?: string;
  productTags?: string;
  /** Increment this number externally to trigger a re-fetch (e.g. after Foresight adds an image). */
  imageAddedKey?: number;
  onApplyText?: (fields: { title?: string; description?: string; tags?: string }) => void;
}

interface ImageSpec {
  type?: string;
  size?: string;
  dimensions?: string;
  dpi?: string;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function inferImageType(src: string, headerType?: string | null): string {
  const cleanHeader = headerType?.split(';')[0]?.trim();
  if (cleanHeader?.startsWith('image/')) return cleanHeader.replace('image/', '').toUpperCase();
  const dataType = src.match(/^data:image\/([^;]+)/i)?.[1];
  if (dataType) return dataType.toUpperCase();
  const ext = src.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1];
  return ext ? ext.toUpperCase().replace('JPG', 'JPEG') : 'Unknown';
}

function dataUrlBytes(src: string): number | null {
  const match = src.match(/^data:[^,]+,(.*)$/);
  if (!match) return null;
  const payload = match[1];
  if (src.includes(';base64,')) return Math.floor((payload.length * 3) / 4) - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
  return decodeURIComponent(payload).length;
}

export default function ProductImageGallery({ productId, productName = 'Product', businessId = '', productTitle = '', productDescription = '', productTags = '', imageAddedKey, onApplyText }: Props) {
  const [images, setImages]       = useState<ProductImage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput]   = useState('');
  const [showUrl, setShowUrl]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [imageSpecs, setImageSpecs] = useState<Record<string, ImageSpec>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Drag-and-drop reorder state
  const [dragSrcId,  setDragSrcId]  = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  const fetchImages = async () => {
    try {
      const r = await fetch(`/api/ims/products/${productId}/images`);
      const d = await r.json();
      if (d.success) setImages(d.data ?? []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchImages(); }, [productId]);
  // Re-fetch when an external caller adds an image (e.g. Foresight)
  useEffect(() => { if (imageAddedKey) fetchImages(); }, [imageAddedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPrimary = async (id: number) => {
    await fetch(`/api/ims/products/${productId}/images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_primary', image_id: id }),
    });
    await fetchImages();
    // Shopify sync happens server-side automatically
  };

  const deleteImage = async (id: number) => {
    const img = images.find(i => i.id === id);
    let deleteFromShopify = false;
    if (img?.source === 'shopify') {
      const choice = window.confirm(
        'This media item is synced with Shopify.\n\nClick OK to also DELETE it from Shopify.\nClick Cancel to remove from IMS only (keeps it in Shopify).'
      );
      deleteFromShopify = choice;
    }
    await fetch(`/api/ims/products/${productId}/images?imageId=${id}&deleteFromShopify=${deleteFromShopify}`, { method: 'DELETE' });
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
    s === 'shopify' ? '🛍' : s === 'google_drive' ? '📁' : s === 'volume' ? '💾' : '🔗';

  const isVideoMedia = (img: ProductImage) =>
    /\.(mp4|mov|webm)(\?|$)/i.test(img.url) || /\.(mp4|mov|webm)$/i.test(img.drive_file_id ?? '');

  const imageMedia = images.filter(img => !isVideoMedia(img));
  const videoMedia = images.filter(isVideoMedia);
  const primary    = imageMedia[0] ?? null; // first sorted image = primary image
  const imageThumbs = imageMedia.filter(i => i.id !== primary?.id);

  const updateImageSpec = (src: string, patch: ImageSpec) => {
    setImageSpecs(prev => ({ ...prev, [src]: { ...prev[src], ...patch, dpi: prev[src]?.dpi ?? patch.dpi ?? 'Unavailable' } }));
  };

  const enrichImageSpec = async (src: string) => {
    if (imageSpecs[src]?.size && imageSpecs[src]?.type) return;
    const dataBytes = dataUrlBytes(src);
    if (dataBytes != null) {
      updateImageSpec(src, { type: inferImageType(src), size: formatBytes(dataBytes), dpi: 'Unavailable' });
      return;
    }
    try {
      const res = await fetch(src, { method: 'HEAD' });
      updateImageSpec(src, {
        type: inferImageType(src, res.headers.get('content-type')),
        size: res.headers.get('content-length') ? formatBytes(Number(res.headers.get('content-length'))) : 'Unknown',
        dpi: 'Unavailable',
      });
    } catch {
      updateImageSpec(src, { type: inferImageType(src), size: 'Unknown', dpi: 'Unavailable' });
    }
  };

  // ── Drag-and-drop reorder ──────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDragSrcId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragSrcId) setDragOverId(id);
  };

  const handleDragEnd = () => { setDragSrcId(null); setDragOverId(null); };

  const handleDrop = async (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (!dragSrcId || dragSrcId === targetId) { handleDragEnd(); return; }

    const newOrder = [...images];
    const srcIdx = newOrder.findIndex(i => i.id === dragSrcId);
    const tgtIdx = newOrder.findIndex(i => i.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) { handleDragEnd(); return; }

    const [moved] = newOrder.splice(srcIdx, 1);
    newOrder.splice(tgtIdx, 0, moved);

    // Optimistic UI update
    setImages(newOrder);
    setDragSrcId(null); setDragOverId(null);

    try {
      await fetch(`/api/ims/products/${productId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reorder', ordered_ids: newOrder.map(i => i.id) }),
      });
      await fetchImages(); // re-fetch to pick up updated is_primary + sort_order
    } catch {}
  };

  if (loading) return <div style={{ fontSize: 12, color: 'var(--sv-text-dim)', padding: '8px 0' }}>Loading media…</div>;

  return (
    <div>
      <style>{`
        .product-media-hover-tile {
          overflow: visible;
          position: relative;
          z-index: 1;
        }
        .product-media-hover-tile:hover {
          z-index: 30;
        }
        .product-media-hover-frame {
          transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
          transform-origin: center center;
        }
        .product-media-hover-tile:hover .product-media-hover-frame {
          transform: scale(2.15);
          box-shadow: 0 16px 42px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.18);
        }
        .product-media-specs {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          padding: 4px 5px;
          background: linear-gradient(180deg, transparent, rgba(0,0,0,.82) 18%, rgba(0,0,0,.88));
          color: #fff;
          font-size: 7px;
          line-height: 1.25;
          opacity: 0;
          transition: opacity .12s ease;
          pointer-events: none;
          text-align: left;
        }
        .product-media-hover-tile:hover .product-media-specs {
          opacity: 1;
        }
        .product-media-primary:hover .product-media-specs {
          opacity: 1;
        }
      `}</style>
      {aiPanelOpen && (
        <ProductAICreativePanel
          productId={productId}
          productName={productName}
          businessId={businessId}
          productTitle={productTitle}
          productDescription={productDescription}
          productTags={productTags}
          onApplyText={onApplyText}
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
        }} className="product-media-primary" onMouseEnter={() => { if (primary) enrichImageSpec(primary.url); }}>
          {primary ? (
            <>
              <img
                src={primary.url}
                alt={primary.alt_text ?? ''}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                onLoad={e => {
                  updateImageSpec(primary.url, { dimensions: `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}px`, type: inferImageType(primary.url), dpi: 'Unavailable' });
                  enrichImageSpec(primary.url);
                }}
              />
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
              <div className="product-media-specs">
                <div>{imageSpecs[primary.url]?.type ?? inferImageType(primary.url)} · {imageSpecs[primary.url]?.size ?? 'Size unknown'}</div>
                <div>{imageSpecs[primary.url]?.dimensions ?? 'Dimensions loading'}</div>
                <div>DPI: {imageSpecs[primary.url]?.dpi ?? 'Unavailable'}</div>
              </div>
            </>
          ) : (
            <span style={{ fontSize: 28, opacity: 0.25 }}>🖼</span>
          )}
        </div>

        {/* Media */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>Images</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflow: 'visible' }}>
                {imageThumbs.map(img => (
                  <div
                    key={img.id}
                    draggable
                    onClick={() => setPrimary(img.id)}
                    onDragStart={e => handleDragStart(e, img.id)}
                    onDragOver={e => handleDragOver(e, img.id)}
                    onDragEnd={handleDragEnd}
                    onDrop={e => handleDrop(e, img.id)}
                    className="product-media-hover-tile"
                    style={{ width: 64, height: 64, cursor: 'grab', flexShrink: 0, opacity: dragSrcId === img.id ? 0.45 : 1 }}
                    title="Drag to reorder · click to set as primary image"
                  >
                    <div className="product-media-hover-frame" style={{ width: 64, height: 64, borderRadius: 6, border: dragOverId === img.id ? '2px solid var(--sv-action)' : '1px solid var(--sv-etch)', overflow: 'hidden', background: 'var(--sv-bg-2)', position: 'relative' }}>
                      <img
                        src={img.url}
                        alt={img.alt_text ?? ''}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }}
                        onLoad={e => {
                          updateImageSpec(img.url, { dimensions: `${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}px`, type: inferImageType(img.url), dpi: 'Unavailable' });
                          enrichImageSpec(img.url);
                        }}
                      />
                      <span style={{ position: 'absolute', bottom: 2, left: 2, fontSize: 9, background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 3, padding: '0 3px' }}>{sourceLabel(img.source)}</span>
                      <div className="product-media-specs">
                        <div>{imageSpecs[img.url]?.type ?? inferImageType(img.url)} · {imageSpecs[img.url]?.size ?? 'Size unknown'}</div>
                        <div>{imageSpecs[img.url]?.dimensions ?? 'Dimensions loading'}</div>
                        <div>DPI: {imageSpecs[img.url]?.dpi ?? 'Unavailable'}</div>
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteImage(img.id); }}
                      title="Remove"
                      style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, lineHeight: '18px', textAlign: 'center' }}
                    >×</button>
                  </div>
                ))}

                {/* Add placeholder if < 8 */}
                {images.length < 8 && (
                  <div
                    onClick={() => fileRef.current?.click()}
                    style={{ width: 64, height: 64, borderRadius: 6, border: '2px dashed var(--sv-etch)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.5 : 1, color: 'var(--sv-text-dim)', fontSize: 22 }}
                    title="Upload media"
                  >
                    {uploading ? '…' : '+'}
                  </div>
                )}
              </div>
            </div>

            {videoMedia.length > 0 && (
              <div style={{ minWidth: 150 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--sv-text-dim)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 4 }}>Videos</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {videoMedia.map(img => (
                    <div
                      key={img.id}
                      draggable
                      onDragStart={e => handleDragStart(e, img.id)}
                      onDragOver={e => handleDragOver(e, img.id)}
                      onDragEnd={handleDragEnd}
                      onDrop={e => handleDrop(e, img.id)}
                      style={{ width: 140, borderRadius: 8, border: dragOverId === img.id ? '2px solid var(--sv-action)' : '1px solid var(--sv-etch)', overflow: 'hidden', position: 'relative', background: 'var(--sv-bg-2)', cursor: 'grab', flexShrink: 0, opacity: dragSrcId === img.id ? 0.45 : 1 }}
                      title="Video media · use controls to play · drag to reorder"
                    >
                      <video
                        src={img.url}
                        controls
                        preload="metadata"
                        playsInline
                        style={{ width: '100%', height: 118, objectFit: 'cover', display: 'block', background: '#000' }}
                      />
                      <span style={{ position: 'absolute', bottom: 4, left: 4, fontSize: 9, background: 'rgba(0,0,0,0.62)', color: '#fff', borderRadius: 3, padding: '0 4px', pointerEvents: 'none' }}>{sourceLabel(img.source)} Video</span>
                      <button
                        onClick={e => { e.stopPropagation(); deleteImage(img.id); }}
                        title="Remove"
                        style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.62)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 11, lineHeight: '20px', textAlign: 'center' }}
                      >×</button>
                    </div>
                  ))}
                </div>
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
            {images.length}/8 media items · primary image shown once on the left · videos grouped to the right
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
