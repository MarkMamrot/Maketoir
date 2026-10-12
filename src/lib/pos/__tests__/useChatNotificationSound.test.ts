// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isIncomingChatMessage, useChatNotificationSound } from '../useChatNotificationSound';

describe('chat sound', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('only treats group messages and direct messages from another location as incoming', () => {
    expect(isIncomingChatMessage({ location_id: 2 }, 1)).toBe(true);
    expect(isIncomingChatMessage({ location_id: 2, to_location_id: 1 }, 1)).toBe(true);
    expect(isIncomingChatMessage({ location_id: 1, to_location_id: 2 }, 1)).toBe(false);
    expect(isIncomingChatMessage({ location_id: 2, to_location_id: 3 }, 1)).toBe(false);
  });
  it('unlocks on interaction, plays a short alert and closes audio on unmount', () => {
    const frequency = { setValueAtTime: vi.fn() };
    const oscillator = { frequency, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const audio = { state: 'running', currentTime: 1, destination: {}, createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain), close: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('AudioContext', class { constructor() { return audio; } });
    const hook = renderHook(useChatNotificationSound);
    act(() => hook.result.current());
    expect(oscillator.start).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new Event('pointerdown')));
    act(() => hook.result.current());
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(oscillator.stop).toHaveBeenCalledWith(1.3);
    hook.unmount();
    expect(audio.close).toHaveBeenCalledOnce();
  });
});