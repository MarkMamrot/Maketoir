'use client';

import { reportPosDeviceIssue } from './posDeviceDiagnostics';

declare global { interface Window { webkitAudioContext?: typeof AudioContext } }

type PosSound = 'chat' | 'error' | 'transfer-error';
let audio: AudioContext | null = null;
let businessId: string | undefined;
let interacted = false;
let muted = false;
let volatilePreference = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const playing = new Map<OscillatorNode, GainNode>();

export function getPosSoundsMuted(): boolean {
  if (typeof window === 'undefined' || volatilePreference) return muted;
  try { muted = localStorage.getItem('pos_sounds_muted') === '1'; }
  catch { reportPosDeviceIssue('pos_audio_playback', 'The POS sound preference could not be read.', businessId); }
  return muted;
}

function stopSounds() {
  if (idleTimer) clearTimeout(idleTimer);
  for (const [oscillator, gain] of playing) {
    oscillator.onended = null;
    oscillator.stop(); oscillator.disconnect(); gain.disconnect();
  }
  playing.clear();
}

export function setPosSoundsMuted(value: boolean): void {
  muted = value;
  if (value) {
    stopSounds();
    if (audio?.state === 'running') void audio.suspend().catch(() => {
      reportPosDeviceIssue('pos_audio_playback', 'POS audio could not be suspended after muting.', businessId);
    });
  }
  try { localStorage.setItem('pos_sounds_muted', value ? '1' : '0'); volatilePreference = false; }
  catch (error) {
    volatilePreference = true;
    reportPosDeviceIssue('pos_audio_playback', 'The POS sound preference could not be saved; it only applies to this open page.', businessId);
    throw error;
  }
}

export function startPosSoundSession(id: string): () => void {
  businessId = id;
  interacted = false;
  const interaction = () => { interacted = true; };
  document.addEventListener('pointerdown', interaction, true);
  document.addEventListener('keydown', interaction, true);
  return () => {
    document.removeEventListener('pointerdown', interaction, true);
    document.removeEventListener('keydown', interaction, true);
    stopSounds();
    const context = audio;
    audio = null;
    interacted = false;
    businessId = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {
      reportPosDeviceIssue('pos_audio_playback', 'POS audio could not be closed at session end.', id);
    });
  };
}

export function playPosSound(sound: PosSound): void {
  if (!interacted || getPosSoundsMuted()) return;
  const owner = businessId;
  void (async () => {
    const Constructor = window.AudioContext ?? window.webkitAudioContext;
    if (!Constructor) throw new Error('Browser audio is unavailable.');
    const context = audio ??= new Constructor();
    if (idleTimer) clearTimeout(idleTimer);
    if (context.state === 'suspended') await context.resume();
    if (audio !== context || muted || !interacted) {
      if (audio === context && context.state === 'running' && playing.size === 0) await context.suspend();
      return;
    }
    const tones = sound === 'chat'
      ? [{ frequency: 740, start: 0, end: 0.12 }, { frequency: 988, start: 0.12, end: 0.3 }]
      : sound === 'error'
      ? [{ frequency: 880, start: 0, end: 0.18 }, { frequency: 440, start: 0.2, end: 0.45 }]
      : [{ frequency: 200, start: 0, end: 0.45 }];
    for (const tone of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.type = sound === 'chat' ? 'sine' : 'square';
      oscillator.frequency.setValueAtTime(tone.frequency, context.currentTime);
      gain.gain.setValueAtTime(sound === 'chat' ? 0.12 : 0.25, context.currentTime + tone.start);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + tone.end);
      oscillator.onended = () => {
        oscillator.disconnect(); gain.disconnect(); playing.delete(oscillator);
        if (audio === context && playing.size === 0) {
          idleTimer = setTimeout(() => {
            if (audio === context && context.state === 'running' && playing.size === 0) {
              void context.suspend().catch(() => {
                reportPosDeviceIssue('pos_audio_playback', 'POS audio could not be suspended between alerts.', owner);
              });
            }
          }, 250);
        }
      };
      oscillator.start(context.currentTime + tone.start);
      playing.set(oscillator, gain);
      oscillator.stop(context.currentTime + tone.end);
    }
  })().catch(() => {
    reportPosDeviceIssue('pos_audio_playback', 'A POS alert could not be played. Visual alerts remain available.', owner);
  });
}
