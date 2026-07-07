function extractFirstJsonObject(input) {
  let s = (input ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

const cases = [
  '{"a":1,"tags":["x","y"]}\n\nHere is more explanation text after the JSON.',
  '```json\n{"a":1}\n```',
  'Here is the JSON:\n{"a":{"b":2},"s":"has } brace inside string"}\ntrailing junk',
  '{"a":1}',
  'no json here',
];
for (const c of cases) {
  const r = extractFirstJsonObject(c);
  let status;
  try { JSON.parse(r); status = 'OK'; } catch (e) { status = r === null ? 'null (expected for no-json)' : 'FAIL ' + e.message; }
  console.log(status, '::', JSON.stringify(r));
}
