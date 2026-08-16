'use client';

import { RefObject, useEffect } from 'react';

type VerticalScrollTarget = 'window' | 'element';

export function useTableArrowScroll(
  scrollRef: RefObject<HTMLElement>,
  verticalTarget: VerticalScrollTarget = 'window',
) {
  useEffect(() => {
    const handleArrowScroll = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      if ((event.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable="true"]')) return;

      const scroller = scrollRef.current;
      if (!scroller) return;

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const top = event.key === 'ArrowUp' ? -240 : 240;
        if (verticalTarget === 'element') scroller.scrollBy({ top, behavior: 'auto' });
        else window.scrollBy({ top, behavior: 'auto' });
        return;
      }

      if (scroller.scrollWidth <= scroller.clientWidth) return;
      event.preventDefault();
      scroller.scrollBy({ left: event.key === 'ArrowLeft' ? -240 : 240, behavior: 'auto' });
    };

    window.addEventListener('keydown', handleArrowScroll);
    return () => window.removeEventListener('keydown', handleArrowScroll);
  }, [scrollRef, verticalTarget]);
}
