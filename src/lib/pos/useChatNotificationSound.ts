'use client';

import { useCallback } from 'react';
import { playPosSound } from './posSounds';

export function isIncomingChatMessage(message: { location_id: number; to_location_id?: number | null }, locationId: number): boolean {
  return Number(message.location_id) !== locationId && (!message.to_location_id || Number(message.to_location_id) === locationId);
}

export function useChatNotificationSound() {
  return useCallback(() => playPosSound('chat'), []);
}