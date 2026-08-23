'use client';

import { Children, createElement, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import styles from './HelpMarkdown.module.css';

type CalloutKind = 'note' | 'tip' | 'important' | 'warning';

function textContent(value: ReactNode): string {
  return Children.toArray(value).map(child => {
    if (typeof child === 'string' || typeof child === 'number') return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : '';
  }).join(' ');
}

function calloutKind(children: ReactNode): CalloutKind {
  const label = textContent(children).trim().toLowerCase();
  if (label.startsWith('warning:')) return 'warning';
  if (label.startsWith('important:')) return 'important';
  if (label.startsWith('tip:')) return 'tip';
  return 'note';
}

export function HelpMarkdown({ children }: { children: string }) {
  return createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    components: {
      blockquote: ({ children: calloutChildren }) => {
        const kind = calloutKind(calloutChildren);
        return createElement('blockquote', { className: `${styles.callout} ${styles[kind]}` }, calloutChildren);
      },
      table: ({ children: tableChildren }) => createElement(
        'div',
        { className: styles.tableScroll, role: 'region', 'aria-label': 'Scrollable Help table', tabIndex: 0 },
        createElement('table', null, tableChildren),
      ),
    },
    children,
  });
}