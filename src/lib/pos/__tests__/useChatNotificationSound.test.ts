// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isIncomingChatMessage, useChatNotificationSound } from '../useChatNotificationSound';
import { setPosSoundsMuted, startPosSoundSession } from '../posSounds';

describe('chat sound', () => {
  let endSession: () => void;
  beforeEach(() => { localStorage.clear(); setPosSoundsMuted(false); endSession = startPosSoundSession('test-business'); });
  afterEach(() => { endSession(); vi.unstubAllGlobals(); });
  it('only treats group messages and direct messages from another location as incoming', () => {
    expect(isIncomingChatMessage({ location_id: 2 }, 1)).toBe(true);
    expect(isIncomingChatMessage({ location_id: 2, to_location_id: 1 }, 1)).toBe(true);
    expect(isIncomingChatMessage({ location_id: 1, to_location_id: 2 }, 1)).toBe(false);
    expect(isIncomingChatMessage({ location_id: 2, to_location_id: 3 }, 1)).toBe(false);
  });
  it('does not open audio on interaction and keeps it alive across chat component remounts', () => {
    const frequency = { setValueAtTime: vi.fn() };
    const oscillator = { frequency, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const audio = { state: 'running', currentTime: 1, destination: {}, createOscillator: vi.fn(() => oscillator), createGain: vi.fn(() => gain), close: vi.fn().mockResolvedValue(undefined) };
    const constructor = vi.fn(function () { return audio; });
    vi.stubGlobal('AudioContext', constructor);
    const hook = renderHook(useChatNotificationSound);
    act(() => hook.result.current());
    expect(oscillator.start).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new Event('pointerdown')));
    expect(constructor).not.toHaveBeenCalled();
    act(() => hook.result.current());
    expect(constructor).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledTimes(2);
    expect(oscillator.stop).toHaveBeenCalledWith(1.3);
    hook.unmount();
    expect(audio.close).not.toHaveBeenCalled();
    const next = renderHook(useChatNotificationSound);
    act(() => next.result.current());
    expect(constructor).toHaveBeenCalledOnce();
    next.unmount();
    endSession();
    expect(audio.close).toHaveBeenCalledOnce();
    endSession = () => {};
  });
});