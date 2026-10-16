'use client';

import React, { useRef } from 'react';
import { useTableArrowScroll } from '../../hooks/useTableArrowScroll';

export function ConsignmentTable({ headings, rows }: { headings: string[]; rows: React.ReactNode[][] }) {
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useTableArrowScroll(body);
  const width = headings.length * 180;
  const colGroup = () => <colgroup>{headings.map(name => <col key={name} style={{ width: 180 }} />)}</colgroup>;
  const table: React.CSSProperties = { width, tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0 };
  const cell = (frozen: boolean): React.CSSProperties => ({
    padding: 12, borderBottom: '1px solid var(--sv-etch)', textAlign: 'left', overflowWrap: 'anywhere',
    background: 'var(--sv-bg-1)', ...(frozen ? { position: 'sticky', left: 0, zIndex: 2, boxShadow: '1px 0 0 var(--sv-etch)' } : {}),
  });
  return <div style={{ minWidth: 0, maxWidth: '100%', width: '100%' }}>
    <div ref={header} style={{ position: 'sticky', top: 0, overflow: 'hidden', zIndex: 5 }}>
      <table style={table}>{colGroup()}<thead><tr>{headings.map((name, i) => <th key={name} scope="col" style={cell(i === 0)}>{name}</th>)}</tr></thead></table>
    </div>
    <div ref={body} className="ims-sticky-table ims-sticky-table--self-scroll consignment-table-scroll"
      tabIndex={0} role="region" aria-label="Consignment table; arrow keys scroll horizontally and vertically"
      style={{ overflowX: 'auto', overflowY: 'hidden' }}
      onScroll={event => { if (header.current) header.current.scrollLeft = event.currentTarget.scrollLeft; }}>
      <table aria-label="Consignment data" style={table}>{colGroup()}<tbody>
        {rows.map((row, index) => <tr key={index}>{row.map((value, i) => <td key={headings[i]} style={cell(i === 0)}>{value}</td>)}</tr>)}
        {!rows.length && <tr><td colSpan={headings.length} style={cell(false)}>No records for this selection.</td></tr>}
      </tbody></table>
    </div>
  </div>;
}
