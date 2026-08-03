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