const {transform} = require('next/dist/build/swc/index.js');
const opts = { filename: 'test.tsx', jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2017' }, module: { type: 'commonjs' } };
const test = async (name, code) => {
  try { await transform(code, opts); console.log(name + ': OK'); }
  catch (e) { const m = e.message.split('\n').filter(l => l.trim()).slice(0,4).join(' | '); console.log(name + ': FAIL ->', m); }
};

// Test the exact useCallback signature from the failing file
const cbFull = `
import React, { useState, useCallback } from 'react';
type SBDateRange = { kind: 'window'; window: number; label: string } | { kind: 'range'; from: string; to: string; label: string };
export function T({ apiFetch }: { apiFetch: (u: string, o?: RequestInit) => Promise<any> }) {
  const load = useCallback(async (pg: number, ft: string, fb: string, fs_: string, ftype: string, dr: SBDateRange, ps: number, bid: number | null = null) => {
    const x = ft + pg + fb + fs_ + ftype + ps + (bid ?? 0);
    if (dr.kind === 'window') console.log(dr.window);
  }, [apiFetch]);
  return <div onClick={() => load(1,'','','','',{kind:'window',window:1,label:'x'},1,null)} />;
}`;

// Same but without the underscore in fs_
const cbNoUnderscore = `
import React, { useState, useCallback } from 'react';
type SBDateRange = { kind: 'window'; window: number; label: string } | { kind: 'range'; from: string; to: string; label: string };
export function T({ apiFetch }: { apiFetch: (u: string, o?: RequestInit) => Promise<any> }) {
  const load = useCallback(async (pg: number, ft: string, fb: string, fs: string, ftype: string, dr: SBDateRange, ps: number, bid: number | null = null) => {
    const x = ft + pg + fb + fs + ftype + ps + (bid ?? 0);
  }, [apiFetch]);
  return <div />;
}`;

// Without bid default param
const cbNoBid = `
import React, { useCallback } from 'react';
type SBDateRange = { kind: 'window'; window: number; label: string } | { kind: 'range'; from: string; to: string; label: string };
export function T({ apiFetch }: { apiFetch: (u: string) => Promise<any> }) {
  const load = useCallback(async (pg: number, ft: string, fb: string, fs_: string, ftype: string, dr: SBDateRange, ps: number) => {
    const x = ft + pg + fb + fs_ + ftype + ps;
  }, [apiFetch]);
  return <div />;
}`;

// With sortTh before return
const withSortTh = `
import React, { useState } from 'react';
export function T({ onBack }: { onBack: () => void }) {
  const [sortCol, setSortCol] = useState('x');
  const [sortAsc, setSortAsc] = useState(false);
  const hCell: React.CSSProperties = { fontWeight: 600 };
  const sortTh = (col: string, label: string, extra?: React.CSSProperties) => (
    <th onClick={() => { if(sortCol===col) setSortAsc(a=>!a); else setSortCol(col); }} style={{ ...hCell, ...extra }}>
      {label}
    </th>
  );
  return <table><thead><tr>{sortTh('x','X')}</tr></thead></table>;
}`;

(async () => {
  await test('cbFull (exact signature)', cbFull);
  await test('cbNoUnderscore', cbNoUnderscore);
  await test('cbNoBid', cbNoBid);
  await test('withSortTh-arrow', withSortTh);
})();
