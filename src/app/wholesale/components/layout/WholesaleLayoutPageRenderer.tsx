'use client';

import type { CSSProperties, ReactNode } from 'react';
import sanitizeHtml from 'sanitize-html';
import type { WholesaleLayoutSection, WholesaleLayoutSectionType } from '@/lib/wholesale/layout/types';
import styles from './WholesaleLayoutPageRenderer.module.css';

export type WholesaleLayoutFeaturedProduct = {
  product_id: string;
  name: string;
  image_url: string | null;
  images?: string[];
};

const spacing = { none: 0, small: 12, medium: 28, large: 52 } as const;

function safeUrl(value?: string) {
  if (!value) return undefined;
  if (value.startsWith('/')) return value;
  try { return new URL(value).protocol === 'https:' ? value : undefined; } catch { return undefined; }
}

function safeHtml(value?: string) {
  return sanitizeHtml(value ?? '', {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h2', 'h3', 'h4', 'a'],
    allowedAttributes: { a: ['href', 'target', 'rel'] },
    allowedSchemes: ['https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { a: (_tagName, attributes) => ({ tagName: 'a', attribs: { ...attributes, target: '_blank', rel: 'noopener noreferrer' } }) },
  });
}

function SharedSection({ section, products }: { section: WholesaleLayoutSection; products: WholesaleLayoutFeaturedProduct[] }) {
  const settings = section.settings;
  const style = {
    '--section-top': `${spacing[settings.spacingTop ?? 'medium']}px`,
    '--section-bottom': `${spacing[settings.spacingBottom ?? 'medium']}px`,
    backgroundColor: settings.backgroundColor,
    color: settings.textColor,
    textAlign: settings.alignment,
  } as CSSProperties;
  const width = settings.width ?? 'content';
  const imageUrl = safeUrl(settings.imageUrl);
  const linkUrl = safeUrl(settings.linkUrl);
  const copy = <div className={styles.copy}>{settings.heading && <h2>{settings.heading}</h2>}{settings.bodyHtml && <div className={styles.richText} dangerouslySetInnerHTML={{ __html: safeHtml(settings.bodyHtml) }} />}{linkUrl && settings.linkLabel && <a className={styles.link} href={linkUrl}>{settings.linkLabel}</a>}</div>;

  if (section.type === 'divider') return <div className={styles.section} style={style} data-width={width}><hr /></div>;
  if (section.type === 'spacer') return <div className={styles.section} style={style} data-width={width} aria-hidden="true" />;
  if (section.type === 'image') return <section className={styles.section} style={style} data-width={width}>{imageUrl ? <img className={styles.image} src={imageUrl} alt={settings.altText ?? ''} data-ratio={settings.imageRatio ?? 'landscape'} data-fit={settings.imageFit ?? 'cover'} /> : <div className={styles.imagePlaceholder}>Add an image URL</div>}</section>;
  if (section.type === 'text_image') return <section className={`${styles.section} ${styles.textImage}`} style={style} data-width={width} data-alignment={settings.alignment ?? 'left'} data-image-side={settings.imageSide ?? 'right'}>{copy}{imageUrl ? <img className={styles.image} src={imageUrl} alt={settings.altText ?? ''} data-ratio={settings.imageRatio ?? 'landscape'} data-fit={settings.imageFit ?? 'cover'} /> : <div className={styles.imagePlaceholder}>Add an image URL</div>}</section>;
  if (section.type === 'featured_products') {
    const selected = settings.productIds?.length ? products.filter(product => settings.productIds!.includes(product.product_id)) : products;
    return <section className={styles.section} style={style} data-width={width}>{settings.heading && <h2>{settings.heading}</h2>}<div className={styles.productGrid}>{selected.slice(0, settings.productLimit ?? 4).map(product => { const image = product.images?.[0] || product.image_url; return <article key={product.product_id}>{image ? <img src={image} alt="" /> : <div className={styles.productPlaceholder} /> }<strong>{product.name}</strong></article>; })}</div></section>;
  }
  return <section className={`${styles.section} ${section.type === 'banner' ? styles.banner : ''}`} style={style} data-width={width} data-alignment={settings.alignment ?? 'left'}>{copy}</section>;
}

const sharedTypes = new Set<WholesaleLayoutSectionType>(['banner', 'rich_text', 'image', 'text_image', 'divider', 'spacer', 'featured_products']);

export function WholesaleLayoutPageRenderer({ sections, systemSections, products = [] }: {
  sections: WholesaleLayoutSection[];
  systemSections: Partial<Record<WholesaleLayoutSectionType, ReactNode>>;
  products?: WholesaleLayoutFeaturedProduct[];
}) {
  return <>{sections.map(section => sharedTypes.has(section.type)
    ? <SharedSection key={section.id} section={section} products={products} />
    : systemSections[section.type] ? <div key={section.id}>{systemSections[section.type]}</div> : null)}</>;
}
