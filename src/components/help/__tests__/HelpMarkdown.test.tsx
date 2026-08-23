import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { HelpMarkdown } from '../HelpMarkdown';

describe('HelpMarkdown', () => {
  it('renders labelled warnings and an accessible scrollable table', () => {
  const markdown = `> **Warning:** Complete the return only once.

| Status | Action |
|---|---|
| Ready | Continue |`;
  const html = renderToStaticMarkup(createElement(HelpMarkdown, null, markdown));

  expect(html).toContain('warning');
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="Scrollable Help table"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain('<table>');
  });

  it('renders task-list checkboxes as disabled documentation controls', () => {
    const html = renderToStaticMarkup(createElement(HelpMarkdown, null, '- [ ] Count the physical stock'));
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Count the physical stock');
  });
});