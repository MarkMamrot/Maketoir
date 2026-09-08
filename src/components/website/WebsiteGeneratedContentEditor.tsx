'use client';

import React from 'react';
import { RichTextEditor } from '@/components/editor/RichTextEditor';

export interface WebsiteGeneratedContent {
  title: string;
  websiteDescription: string;
  tags: string;
}

type WebsiteContentField = keyof WebsiteGeneratedContent;

export function WebsiteGeneratedContentEditor({
  content,
  heading = 'Generated Content',
  headerAction,
  footer,
  onChange,
  onApplyField,
}: {
  content: WebsiteGeneratedContent;
  heading?: React.ReactNode;
  headerAction?: React.ReactNode;
  footer?: React.ReactNode;
  onChange: (field: WebsiteContentField, value: string) => void;
  onApplyField?: (field: WebsiteContentField) => void;
}) {
  const applyButton = (field: WebsiteContentField, label: string) => onApplyField ? (
    <button
      type="button"
      onClick={() => onApplyField(field)}
      className="rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100"
      title={`Apply ${label.toLowerCase()} to the product`}
    >
      Apply
    </button>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-800">{heading}</h3>
        {headerAction}
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Website Title</label>
          {applyButton('title', 'Website Title')}
        </div>
        <input
          value={content.title}
          onChange={event => onChange('title', event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div>
        <div className="mb-1 flex items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tags</label>
          {applyButton('tags', 'Tags')}
        </div>
        <input
          value={content.tags}
          onChange={event => onChange('tags', event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Website Description</label>
            {applyButton('websiteDescription', 'Website Description')}
          </div>
        </div>
        <RichTextEditor label="Website description" value={content.websiteDescription} onChange={value => onChange('websiteDescription', value)} minHeight={128} />
      </div>

      {footer}
    </div>
  );
}