'use client';

import React, { useState } from 'react';

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
  const [showHtmlSource, setShowHtmlSource] = useState(false);
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
          <button
            type="button"
            onClick={() => setShowHtmlSource(current => !current)}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700"
          >
            {showHtmlSource ? 'Preview' : 'HTML source'}
          </button>
        </div>
        {!showHtmlSource ? (
          <div
            key={`preview-${content.websiteDescription}`}
            contentEditable
            suppressContentEditableWarning
            className="min-h-32 w-full max-w-none cursor-text overflow-auto rounded-lg border border-indigo-300 bg-white px-4 py-3 text-sm leading-6 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 [&_h1]:mb-3 [&_h1]:mt-5 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:pl-6 [&_p]:my-3 [&_ul]:my-3 [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: content.websiteDescription }}
            onBlur={event => onChange('websiteDescription', event.currentTarget.innerHTML)}
          />
        ) : (
          <textarea
            value={content.websiteDescription}
            onChange={event => onChange('websiteDescription', event.target.value)}
            rows={8}
            className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        )}
      </div>

      {footer}
    </div>
  );
}