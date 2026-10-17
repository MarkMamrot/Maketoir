// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IntegrationBelt from '../IntegrationBelt';

vi.mock('next/image', () => ({
  default: ({ src, alt }: { src: string | { src: string }; alt: string }) => <img src={typeof src === 'string' ? src : src.src} alt={alt} />,
}));
afterEach(cleanup);

describe('integration belt', () => {
  it('exposes one provider list and hides the seamless duplicate from assistive technology', () => {
    render(<IntegrationBelt />);
    const list = screen.getByRole('list', { name: 'Integration providers' });
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.queryByText('Cin7')).toBeNull();
    for (const name of ['Xero', 'Shopify', 'Klaviyo', 'Amazon Australia', 'Australia Post', 'eParcel', 'Google Ads & Meta Ads', 'Gmail', 'Zeller', 'Google Analytics']) {
      expect(within(list).getByText(name, { selector: 'p' })).toBeTruthy();
    }
    expect(list.querySelectorAll('img')).toHaveLength(8);
    for (const image of Array.from(list.querySelectorAll('img'))) {
      expect(image.getAttribute('src')).toBeTruthy();
      expect(image.alt).toBe('');
    }
    const duplicate = document.querySelector('ul[aria-hidden="true"]');
    expect(duplicate?.textContent).toBe(list.textContent);
    expect(duplicate?.querySelector('button, a, [tabindex]')).toBeNull();
  });

  it('allows visitors to pause and resume continuous motion', () => {
    render(<IntegrationBelt />);
    const pause = screen.getByRole('button', { name: 'Pause integration animation' });
    expect(pause.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Resume integration animation' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-paused="true"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume integration animation' }));
    expect(document.querySelector('[data-paused="false"]')).toBeTruthy();
  });
});
