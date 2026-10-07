import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GlobalError from '../global-error';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void) => effect(),
}));

describe('global error recovery', () => {
  const reload = vi.fn();
  const reset = vi.fn();
  const fetchMock = vi.fn();
  const href = 'https://example.test/ims#sales-orders/42';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { location: { pathname: '/ims', href, hash: '#sales-orders/42', reload } });
    vi.stubGlobal('fetch', fetchMock.mockResolvedValue({ ok: true }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('reloads the current deep link instead of remounting the exhausted root router', () => {
    const html = GlobalError({ error: new Error('Navigation failed'), reset });
    const children = html.props.children.props.children.props.children as ReactElement<{ onClick?: () => void; children?: string }>[];
    const button = children.find(child => child.type === 'button');

    expect(button?.props.children).toBe('Reload page');
    button?.props.onClick?.();

    expect(reload).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    expect(window.location.href).toBe(href);
    expect(window.location.hash).toBe('#sales-orders/42');
  });

  it('still reports the original failure before recovery', () => {
    const error = Object.assign(new Error('Navigation failed'), { digest: 'safe-digest' });
    GlobalError({ error, reset });

    expect(fetchMock).toHaveBeenCalledWith('/api/runtime-issues/client', expect.objectContaining({
      method: 'POST',
      keepalive: true,
    }));
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ message: 'Navigation failed', digest: 'safe-digest', pathname: '/ims' });
  });

  it('keeps recovery available when reporting fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Offline'));
    const html = GlobalError({ error: new Error('Navigation failed'), reset });
    const children = html.props.children.props.children.props.children as ReactElement<{ onClick?: () => void }>[];
    children.find(child => child.type === 'button')?.props.onClick?.();
    await Promise.resolve();

    expect(reload).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });
});