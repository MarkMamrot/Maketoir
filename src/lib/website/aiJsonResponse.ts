function escapeControlCharactersInStrings(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      result += character;
      continue;
    }
    if (inString && character === '\n') result += '\\n';
    else if (inString && character === '\r') result += '\\r';
    else if (inString && character === '\t') result += '\\t';
    else result += character;
  }

  return result;
}

function removeTrailingCommas(value: string): string {
  let result = '';
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      result += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      result += character;
      continue;
    }
    if (!inString && character === ',') {
      let nextIndex = index + 1;
      while (/\s/.test(value[nextIndex] ?? '')) nextIndex += 1;
      if (value[nextIndex] === '}' || value[nextIndex] === ']') continue;
    }
    result += character;
  }

  return result;
}

function balancedJsonValues(value: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{' || character === '[') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' || character === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

function tryParse<T>(value: string): T | null {
  const trimmed = value.trim();
  const variants = [
    trimmed,
    removeTrailingCommas(trimmed),
    escapeControlCharactersInStrings(trimmed),
    removeTrailingCommas(escapeControlCharactersInStrings(trimmed)),
  ];
  for (const variant of variants) {
    try {
      return JSON.parse(variant) as T;
    } catch {
      // Try the next conservative normalization.
    }
  }
  return null;
}

export async function requestAiJsonResponse<T extends Record<string, unknown>>(
  request: (attempt: number) => Promise<Response>,
): Promise<{ parsed: T | null; lastText: string; lastError: string; attempts: number; requestFailed: boolean }> {
  let lastText = '';
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    let rawResponse: string;
    try {
      response = await request(attempt);
      rawResponse = await response.text();
    } catch (error) {
      lastError = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'AI content generation timed out.'
        : `AI content generation request failed: ${error instanceof Error ? error.message : String(error)}`;
      return { parsed: null, lastText, lastError, attempts: attempt + 1, requestFailed: true };
    }
    if (!response.ok) {
      lastError = `Gemini API error (HTTP ${response.status}): ${rawResponse.slice(0, 300)}`;
      return { parsed: null, lastText, lastError, attempts: attempt + 1, requestFailed: true };
    }
    let body: any;
    try {
      body = JSON.parse(rawResponse);
    } catch {
      lastError = 'Gemini returned a non-JSON HTTP response.';
      continue;
    }
    const parts = body?.candidates?.[0]?.content?.parts;
    const textParts = (Array.isArray(parts) ? parts : [])
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean);
    lastText = textParts.join('\n').trim();
    const parsed = parseAiJsonResponse<T>(textParts);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { parsed, lastText, lastError: '', attempts: attempt + 1, requestFailed: false };
    }
    lastError = lastText ? 'AI response could not be parsed as a JSON object.' : 'AI returned an empty response.';
  }
  return { parsed: null, lastText, lastError, attempts: 2, requestFailed: false };
}

export function parseAiJsonResponse<T = Record<string, unknown>>(textParts: string[] | string): T | null {
  const parts = (Array.isArray(textParts) ? textParts : [textParts])
    .map(part => part.trim())
    .filter(Boolean);
  const inputs = [...parts].reverse();
  if (parts.length > 1) inputs.push(parts.join('\n'));

  for (const input of inputs) {
    const withoutFences = input
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const direct = tryParse<T>(withoutFences);
    if (direct) return direct;
    for (const candidate of balancedJsonValues(withoutFences)) {
      const parsed = tryParse<T>(candidate);
      if (parsed) return parsed;
    }
  }

  return null;
}