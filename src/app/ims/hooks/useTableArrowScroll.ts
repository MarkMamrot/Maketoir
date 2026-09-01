'use client';

import { RefObject, useEffect } from 'react';

type VerticalScrollTarget = 'window' | 'element';

export function useTableArrowScroll(
  scrollRef: RefObject<HTMLElement>,
  verticalTarget: VerticalScrollTarget = 'window',
  options: { captureHorizontalFromControls?: boolean } = {},
) {
  const captureHorizontalFromControls = options.captureHorizontalFromControls === true;
  useEffect(() => {
    const handleArrowScroll = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      const isHorizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
      const isFormControl = Boolean((event.target as HTMLElement | null)?.closest?.('input, select, textarea, [contenteditable="true"]'));
      if (isFormControl && (!isHorizontal || !captureHorizontalFromControls)) return;

      const scroller = scrollRef.current;
      if (!scroller) return;

      if (isHorizontal && captureHorizontalFromControls) event.stopPropagation();

      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const top = event.key === 'ArrowUp' ? -240 : 240;
        if (verticalTarget === 'element') scroller.scrollBy({ top, behavior: 'auto' });
        else window.scrollBy({ top, behavior: 'auto' });
        return;
      }

      event.preventDefault();
      const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
      if (maxScrollLeft <= 2) return;
      scroller.scrollBy({ left: event.key === 'ArrowLeft' ? -240 : 240, behavior: 'auto' });
    };

    window.addEventListener('keydown', handleArrowScroll, { capture: captureHorizontalFromControls });
    return () => window.removeEventListener('keydown', handleArrowScroll, { capture: captureHorizontalFromControls });
  }, [captureHorizontalFromControls, scrollRef, verticalTarget]);
}
