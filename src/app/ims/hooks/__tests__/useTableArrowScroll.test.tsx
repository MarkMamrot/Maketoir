/** @vitest-environment jsdom */
import { cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTableArrowScroll } from '../useTableArrowScroll';

afterEach(() => { cleanup(); document.body.innerHTML = ''; vi.restoreAllMocks(); });
describe('table arrows in settings overlays', () => {
  it('uses the settings page for vertical scrolling, and the table for horizontal scrolling', () => {
    const overlay = document.createElement('div'); overlay.dataset.settingsOverlay = '';
    const page = document.createElement('div'); page.dataset.settingsScroll = '';
    const table = document.createElement('div');
    overlay.append(page); page.append(table); document.body.append(overlay);
    Object.defineProperty(table, 'scrollWidth', { value: 800 });
    Object.defineProperty(table, 'clientWidth', { value: 300 });
    page.scrollBy = vi.fn(); table.scrollBy = vi.fn();
    renderHook(() => useTableArrowScroll({ current: table }));
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) fireEvent.keyDown(table, { key });
    expect(table.scrollBy).toHaveBeenNthCalledWith(1, { left: 240, behavior: 'auto' });
    expect(table.scrollBy).toHaveBeenNthCalledWith(2, { left: -240, behavior: 'auto' });
    expect(page.scrollBy).toHaveBeenNthCalledWith(1, { top: 240, behavior: 'auto' });
    expect(page.scrollBy).toHaveBeenNthCalledWith(2, { top: -240, behavior: 'auto' });
    const input = document.createElement('input'); table.append(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(page.scrollBy).toHaveBeenCalledTimes(2);
  });
  it('does not scroll an underlying workspace while settings is open', () => {
    const overlay = document.createElement('div'); overlay.dataset.settingsOverlay = '';
    const table = document.createElement('div'); table.scrollBy = vi.fn();
    document.body.append(overlay, table);
    renderHook(() => useTableArrowScroll({ current: table }));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(table.scrollBy).not.toHaveBeenCalled();
  });
});
