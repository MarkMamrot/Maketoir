export async function parseWebsiteJsonResponse<T = Record<string, any>>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const status = response.status || 500;
    if (status === 502 || status === 503 || status === 504 || status === 408) {
      throw new Error('The website-content request timed out. Please try again.');
    }
    if (/^\s*</.test(text)) {
      throw new Error(`Website-content server error (HTTP ${status}). Please try again.`);
    }
    throw new Error(text.slice(0, 160) || `Website-content request failed (HTTP ${status}).`);
  }
}