export function dedupeProductPhotoUrls(urls: string[]): string[] {
  const unique = new Map<string, string>();

  for (const rawUrl of urls) {
    const url = rawUrl?.trim();
    if (!url?.startsWith('http')) continue;

    try {
      const parsed = new URL(url);
      const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, '').toLowerCase();
      const key = `${parsed.hostname.toLowerCase()}${pathname}`;
      if (!unique.has(key)) unique.set(key, url);
    } catch {
      if (!unique.has(url)) unique.set(url, url);
    }
  }

  return [...unique.values()];
}