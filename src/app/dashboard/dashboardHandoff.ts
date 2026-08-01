export function dashboardHashView(hash: string): string {
  const raw = hash.replace(/^#/, '').trim();
  return decodeURIComponent(raw.split('?')[0] ?? '');
}

export function dashboardHashParam(hash: string, name: string): string | null {
  const query = hash.replace(/^#/, '').split('?')[1] ?? '';
  return new URLSearchParams(query).get(name);
}

export function buildDashboardHash(view: string, params: Record<string, string | number | null | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && String(value).trim()) query.set(key, String(value));
  }
  const suffix = query.toString();
  return `#${encodeURIComponent(view)}${suffix ? `?${suffix}` : ''}`;
}