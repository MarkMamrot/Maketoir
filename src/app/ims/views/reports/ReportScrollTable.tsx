'use client';

import React, { ReactNode, useRef } from 'react';
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

interface ReportScrollTableProps {
  ariaLabel: string;
  bodyClassName: string;
  tableWidth: number;
  renderColGroup: () => ReactNode;
  headerRows: ReactNode;
  children: ReactNode;
  borderRadius?: number;
}

export function ReportScrollTable({
  ariaLabel,
  bodyClassName,
  tableWidth,
  renderColGroup,
  headerRows,
  children,
  borderRadius = 10,
}: ReportScrollTableProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  useTableArrowScroll(bodyScrollRef);

  const tableStyle: React.CSSProperties = {
    width: tableWidth,
    minWidth: '100%',
    tableLayout: 'fixed',
    borderCollapse: 'separate',
    borderSpacing: 0,
    fontSize: 13,
  };

  return (
    <div style={{ width: '100%', minWidth: 0, background: 'var(--sv-bg-1)', border: '1px solid var(--sv-etch)', borderRadius }}>
      <div
        ref={headerScrollRef}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          overflow: 'hidden',
          background: 'var(--sv-bg-2)',
          borderRadius: `${borderRadius}px ${borderRadius}px 0 0`,
          boxShadow: '0 1px 0 var(--sv-etch)',
        }}
      >
        <table style={tableStyle}>
          {renderColGroup()}
          <thead>{headerRows}</thead>
        </table>
      </div>
      <div
        ref={bodyScrollRef}
        className={`ims-sticky-table ims-sticky-table--self-scroll ${bodyClassName}`}
        tabIndex={0}
        role="region"
        aria-label={ariaLabel}
        onScroll={event => {
          if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        onPointerDown={event => {
          if (!(event.target as HTMLElement).closest('input, select, textarea, button, a')) {
            event.currentTarget.focus({ preventScroll: true });
          }
        }}
        style={{
          width: '100%',
          minWidth: 0,
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-x',
          outline: 'none',
        }}
      >
        <table style={tableStyle}>
          {renderColGroup()}
          {children}
        </table>
      </div>
    </div>
  );
}
