import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import PrivacyPage, { metadata } from '../page';

describe('public privacy policy', () => {
  it('publishes the expanded policy and working section anchors', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(metadata.title).toBe('Privacy Policy | Solvantis');
    expect(html).toContain('<h1 class="mt-2 text-4xl font-black text-slate-950">Privacy policy</h1>');
    expect(html.match(/<section(?:\s|>)/g)).toHaveLength(15);
    const anchors = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
    expect(anchors).toHaveLength(8);
    for (const anchor of anchors) expect(html).toContain(`id="${anchor}"`);
    expect(html).toContain('href="/amazon-data-handling"');
    expect(html).toContain('mailto:sales@solvantis.com');
    expect(html).toContain('Privacy complaint');
  });

  it('states current retention and deletion limitations without claiming automatic Amazon disposal', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    expect(html).toContain('Platform authentication history covers the last 12 calendar months');
    expect(html).not.toContain('records older than 90 days are automatically removed');
    expect(html).not.toContain('retained for up to 90 days');
    expect(html).toContain('it is not automatic 30-day deletion');
    expect(html).toContain('does not automatically remove a separately submitted contact request');
    expect(html).toContain('does not instantly erase every backup');
  });

  it('discloses providers and distinguishes storage encryption from field encryption', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage));
    for (const provider of ['Railway', 'Cloudflare', 'Google', 'Resend', 'Australia Post', 'Stripe']) {
      expect(html).toContain(provider);
    }
    expect(html).toContain('outside Australia');
    expect(html).toContain('not a claim that every personal-information field has separate application-level encryption');
    expect(html).toContain('not access to a retailer');
  });
});
