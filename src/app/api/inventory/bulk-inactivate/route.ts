import { cookies } from 'next/headers';
import { getCin7Credentials } from '@/lib/cin7Helpers';

// Legacy Google Sheets path — only used for "inactivate from previous analysis" manual input
let _GoogleSheetsService: any = null;
async function getGoogleSheetsService() {
  if (!_GoogleSheetsService) {
    const mod = await import('@/services/GoogleSheetsService');
    _GoogleSheetsService = mod.GoogleSheetsService;
  }
  return _GoogleSheetsService;
}

const CIN7_BASE = 'https://api.cin7.com/api/v1';
const MAX_RETRIES = 5;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Fetch with automatic retry on 429.
 * Returns { res, retryAfterHeader, body429 } so callers can log details.
 */
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  onWait?: (seconds: number, attempt: number, detail: string) => void,
): Promise<Response> {
  let backoff = 5000;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || attempt === MAX_RETRIES) return res;
    const retryAfter = res.headers.get('Retry-After');
    const body429 = await res.text().catch(() => '');
    const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
    const detail = `Retry-After: ${retryAfter ?? 'none'} | body: ${body429.slice(0, 80)}`;
    console.warn(`[bulk-inactivate] 429 — waiting ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES}) ${detail}`);
    onWait?.(Math.round(wait / 1000), attempt + 1, detail);
    await sleep(wait);
    backoff = Math.min(backoff * 2, 60000);
  }
  return fetch(url, opts);
}

/** Encode a single SSE event line */
function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * POST /api/inventory/bulk-inactivate
 * Body: { databaseId: string; productIds?: string[]; spreadsheetId?: string }
 *
 * Accepts EITHER:
 *   - productIds: string[] — array of Cin7 parent product IDs (preferred, no Google Sheets needed)
 *   - spreadsheetId: string — legacy: reads IDs from a previously saved Google Sheets export
 *
 * Streams Server-Sent Events (text/event-stream) so the client can show real-time progress.
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return new Response(sseEvent({ type: 'fatal', error: 'Not authenticated.' }), {
      status: 401,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const { databaseId, productIds, spreadsheetId } = await req.json();
  if (!databaseId) {
    return new Response(sseEvent({ type: 'fatal', error: 'databaseId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }
  if (!productIds?.length && !spreadsheetId) {
    return new Response(sseEvent({ type: 'fatal', error: 'Either productIds or spreadsheetId is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(encoder.encode(sseEvent(data)));

      try {
        // ── 1. Load Cin7 credentials ──────────────────────────────────────
        let authHeader = '';
        try {
          const creds = await getCin7Credentials(databaseId);
          authHeader = creds.authHeader;
        } catch (e: any) {
          send({ type: 'fatal', error: `Cin7 credentials not found: ${e.message}` });
          controller.close(); return;
        }

        if (!authHeader) {
          send({ type: 'fatal', error: 'Cin7 Account ID and API Key not found. Check the Connections page.' });
          controller.close(); return;
        }

        // ── 2. Build list of product IDs ──────────────────────────────────
        let uniqueIds: string[] = [];
        const labelMap = new Map<string, string>();

        if (productIds?.length) {
          // ── Primary path: productIds passed directly from frontend ──────
          uniqueIds = [...new Set((productIds as string[]).filter(Boolean))];
          for (const id of uniqueIds) labelMap.set(id, id);
        } else {
          // ── Legacy path: read IDs from a Google Sheets export ───────────
          try {
            const GoogleSheetsService = await getGoogleSheetsService();
            const sheets = new GoogleSheetsService();
            const data = await sheets.getData(spreadsheetId, 'Sheet1');
            if (!data || data.length < 2) {
              send({ type: 'fatal', error: 'The spreadsheet is empty or has no data rows. Nothing to inactivate.' });
              controller.close(); return;
            }
            const sheetRows = data as string[][];
            const headers   = sheetRows[0];
            const idColIdx   = headers.indexOf('id');
            const nameColIdx = headers.indexOf('name');
            const codeColIdx = headers.indexOf('code');

            if (idColIdx === -1) {
              send({ type: 'fatal', error: 'Spreadsheet is missing the "id" column. Please re-run the analysis.' });
              controller.close(); return;
            }

            const dataRows = sheetRows.slice(1).filter(r => r[idColIdx]?.trim());
            if (!dataRows.length) {
              send({ type: 'fatal', error: 'No products remain in the spreadsheet. Nothing to inactivate.' });
              controller.close(); return;
            }

            uniqueIds = [...new Set(dataRows.map(r => r[idColIdx].trim()))];
            for (const id of uniqueIds) {
              const rep = dataRows.find(r => r[idColIdx].trim() === id);
              labelMap.set(id, rep ? `${rep[codeColIdx] ?? ''} ${rep[nameColIdx] ?? ''}`.trim() : id);
            }
          } catch (e: any) {
            send({ type: 'fatal', error: `Could not read spreadsheet: ${e.message}` });
            controller.close(); return;
          }
        }

        if (!uniqueIds.length) {
          send({ type: 'fatal', error: 'No products to inactivate.' });
          controller.close(); return;
        }

        send({ type: 'start', total: uniqueIds.length });

        // Cin7 limits: 3 req/sec AND 60 req/min.
        // 1 100 ms between calls ≈ 54/min, under both caps.
        const INTER_REQUEST_DELAY_MS = 1100;

        // ── 3. PUT products one at a time ─────────────────────────────────
        const inactivated: string[] = [];
        const skipped:     string[] = [];
        const errors:      string[] = [];

        for (let i = 0; i < uniqueIds.length; i++) {
          if (i > 0) await sleep(INTER_REQUEST_DELAY_MS);
          const id    = uniqueIds[i];
          const label = labelMap.get(id) ?? id;

          send({ type: 'processing', label, index: i + 1, total: uniqueIds.length });

          try {
            const putRes = await fetchWithRetry(
              `${CIN7_BASE}/Products`,
              {
                method: 'PUT',
                headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
                body: JSON.stringify([{ id, status: 'Inactive' }]),
              },
              (seconds, attempt, detail) =>
                send({ type: 'retrying', label, seconds, attempt, detail }),
            );

            if (!putRes.ok) {
              const errText = await putRes.text();
              const msg = `PUT failed (HTTP ${putRes.status}) — ${errText.slice(0, 200)}`;
              errors.push(`${label}: ${msg}`);
              send({ type: 'error', label, message: msg });
            } else {
              const putBody = await putRes.json();
              const result  = Array.isArray(putBody) ? putBody[0] : putBody;
              if (!result) {
                errors.push(`${label}: no result in response`);
                send({ type: 'error', label, message: 'no result in response' });
              } else if (result.success === false) {
                const errMsg: string = (result.errors ?? []).join('; ');
                if (/already\s*inactive/i.test(errMsg)) {
                  skipped.push(`${label}: already inactive`);
                  send({ type: 'skipped', label, reason: 'already inactive' });
                } else {
                  errors.push(`${label}: ${errMsg.slice(0, 120)}`);
                  send({ type: 'error', label, message: errMsg.slice(0, 120) });
                }
              } else {
                inactivated.push(label);
                send({ type: 'inactivated', label });
              }
            }
          } catch (e: any) {
            errors.push(`${label}: ${e.message}`);
            send({ type: 'error', label, message: e.message });
          }
        }

        send({ type: 'done', total: uniqueIds.length, inactivated, skipped, errors });
      } catch (e: any) {
        controller.enqueue(encoder.encode(sseEvent({ type: 'fatal', error: e.message })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
