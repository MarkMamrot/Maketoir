'use client';

import { useCallback, useEffect, useRef } from 'react';

export function isIncomingChatMessage(message: { location_id: number; to_location_id?: number | null }, locationId: number): boolean {
  return Number(message.location_id) !== locationId && (!message.to_location_id || Number(message.to_location_id) === locationId);
}

export function useChatNotificationSound() {
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => {
      try {
        audioRef.current ??= new AudioContext();
        if (audioRef.current.state === 'suspended') void audioRef.current.resume().catch(() => {});
      } catch {}
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
      const audio = audioRef.current;
      audioRef.current = null;
      if (audio && audio.state !== 'closed') void audio.close().catch(() => {});
    };
  }, []);

  return useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.state !== 'running') return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(740, audio.currentTime);
      oscillator.frequency.setValueAtTime(988, audio.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.3);
    } catch {}
  }, []);
}