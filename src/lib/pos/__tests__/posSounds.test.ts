// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPosSoundsMuted, playPosSound, setPosSoundsMuted, startPosSoundSession } from '../posSounds';

class Oscillator {
  onended: (() => void) | null = null;
  type = '';
  frequency = { setValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
}
class Gain {
  gain = { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn();
  disconnect = vi.fn();
}

function audioDevice() {
  return {
    state: 'running' as AudioContextState, currentTime: 1, destination: {},
    createOscillator: vi.fn(() => new Oscillator()), createGain: vi.fn(() => new Gain()),
    suspend: vi.fn(async function () { device.state = 'suspended'; }),
    resume: vi.fn(async function () { device.state = 'running'; }),
    close: vi.fn(async function () { device.state = 'closed'; }),
  };
}
let device: ReturnType<typeof audioDevice>;
let constructor: ReturnType<typeof vi.fn>;
let endSession: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setPosSoundsMuted(false);
  device = audioDevice();
  constructor = vi.fn(function () { return device; });
  vi.stubGlobal('AudioContext', constructor);
  endSession = startPosSoundSession('sound-business');
});
afterEach(() => { endSession(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('POS device sounds', () => {
  it.each(['mute', 'session-end'])('does not play stale audio after a pending resume and %s', async action => {
    document.dispatchEvent(new Event('pointerdown'));
    device.state = 'suspended';
    let resume: () => void = () => {};
    device.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve; }));
    playPosSound('chat');
    expect(device.resume).toHaveBeenCalledOnce();
    if (action === 'mute') setPosSoundsMuted(true);
    else { endSession(); endSession = () => {}; }
    device.state = 'running';
    resume();
    await Promise.resolve();
    expect(device.createOscillator).not.toHaveBeenCalled();
    if (action === 'mute') expect(device.suspend).toHaveBeenCalledOnce();
    else expect(device.close).toHaveBeenCalledOnce();
  });

  it('never opens an audio stream just for a click, key, or receipt navigation', () => {
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    expect(constructor).not.toHaveBeenCalled();
    expect(device.close).not.toHaveBeenCalled();
  });

  it('mutes every Solvantis tone without opening audio, and persists the device preference', () => {
    document.dispatchEvent(new Event('pointerdown'));
    setPosSoundsMuted(true);
    for (const sound of ['chat', 'error', 'transfer-error'] as const) playPosSound(sound);
    expect(constructor).not.toHaveBeenCalled();
    expect(localStorage.getItem('pos_sounds_muted')).toBe('1');
    expect(getPosSoundsMuted()).toBe(true);
  });

  it('shares one audio context, releases tone nodes, and suspends between alerts instead of closing', async () => {
    document.dispatchEvent(new Event('pointerdown'));
    playPosSound('chat');
    expect(constructor).toHaveBeenCalledOnce();
    const tones = device.createOscillator.mock.results.map(result => result.value);
    tones.forEach(tone => tone.onended?.());
    await vi.advanceTimersByTimeAsync(250);
    expect(device.suspend).toHaveBeenCalledOnce();
    expect(device.close).not.toHaveBeenCalled();
    expect(device.createGain.mock.results.every(result => result.value.disconnect.mock.calls.length === 1)).toBe(true);
    playPosSound('error');
    await Promise.resolve();
    expect(device.resume).toHaveBeenCalledOnce();
    expect(constructor).toHaveBeenCalledOnce();
    endSession();
    expect(device.close).toHaveBeenCalledOnce();
    endSession = () => {};
  });

  it('stops current tones when muted and does not replay them on unmute', () => {
    document.dispatchEvent(new Event('pointerdown'));
    playPosSound('transfer-error');
    const tone = device.createOscillator.mock.results[0].value;
    setPosSoundsMuted(true);
    expect(tone.disconnect).toHaveBeenCalledOnce();
    expect(tone.onended).toBeNull();
    setPosSoundsMuted(false);
    expect(device.createOscillator).toHaveBeenCalledOnce();
  });

  it('retains mute in memory after storage failure and reports the loss of persistence', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    expect(() => setPosSoundsMuted(true)).toThrow('Storage unavailable');
    document.dispatchEvent(new Event('pointerdown'));
    playPosSound('error');
    expect(getPosSoundsMuted()).toBe(true);
    expect(constructor).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledOnce();
    write.mockRestore();
    setPosSoundsMuted(false);
  });
});
