// Recovery merge: combine HEAD's clean Unicode with the working tree's session code changes.
// For each target file:
//   - headLines  = clean version from HEAD (correct em-dashes, ellipses, dividers)
//   - workLines  = working tree (real session ASCII changes + mojibake corruption)
// We LCS-diff on an ASCII skeleton. Matched lines -> emit HEAD (clean). Work-only lines -> emit work.
// Safety: merged ASCII skeleton MUST equal work ASCII skeleton (no code lost) AND be valid UTF-8.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node merge-clean-encoding.mjs <file>...');
  process.exit(1);
}

// ASCII skeleton used for matching / verification.
const skel = (s) => s.replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim();

function lcsMerge(headLines, workLines) {
  const n = headLines.length, m = workLines.length;
  const hs = headLines.map(skel), ws = workLines.map(skel);
  // DP table of LCS lengths
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = hs[i] === ws[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (hs[i] === ws[j]) {
      out.push(headLines[i]); // matched -> clean Unicode from HEAD
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++; // line only in HEAD (removed by session) -> drop
    } else {
      out.push(workLines[j]); // line only in work (added/changed by session) -> keep
      j++;
    }
  }
  while (j < m) { out.push(workLines[j]); j++; }
  return out;
}

let ok = 0, skipped = 0;
for (const f of files) {
  let headBuf;
  try { headBuf = execSync(`git show HEAD:${f}`, { maxBuffer: 1e8 }); }
  catch { console.log(`SKIP (no HEAD): ${f}`); skipped++; continue; }

  const headText = headBuf.toString('utf8').replace(/\r\n/g, '\n');
  const workText = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const headLines = headText.split('\n');
  const workLines = workText.split('\n');

  const merged = lcsMerge(headLines, workLines).join('\n');

  // Safety 1: no code lost — merged ASCII skeleton equals work ASCII skeleton
  if (skel(merged) !== skel(workText)) {
    console.log(`SKIP (ascii mismatch, would lose code): ${f}`);
    skipped++;
    continue;
  }
  // Safety 2: valid UTF-8
  try { new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(merged, 'utf8')); }
  catch { console.log(`SKIP (invalid utf8): ${f}`); skipped++; continue; }

  const remaining = (merged.match(/\uFFFD/g) || []).length;
  writeFileSync(f, merged, 'utf8');
  console.log(`OK: ${f}  (remaining U+FFFD: ${remaining})`);
  ok++;
}
console.log(`\nDone. merged=${ok} skipped=${skipped}`);
