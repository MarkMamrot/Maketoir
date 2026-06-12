import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { decrypt } from '@/lib/encryption';

const CIN7_BASE = 'https://api.cin7.com/api/v1';
const IMAGE_FETCH_TIMEOUT_MS = 15_000;

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function fetchWithTimeout(url: string, timeoutMs = IMAGE_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

const CIN7_ATTEMPT_TIMEOUT_MS = 30_000;

async function fetchWithRetry(url: string, opts: RequestInit): Promise<Response> {
  let backoff = 5000;
  for (let attempt = 0; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CIN7_ATTEMPT_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status !== 429 || attempt === 3) return res;
    const retryAfter = res.headers.get('Retry-After');
    const wait = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff;
    await sleep(wait);
    backoff = Math.min(backoff * 2, 60000);
  }
  // final attempt with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIN7_ATTEMPT_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const { databaseId, productId, styleCode, title, cin7Description, images } = body;

    if (!databaseId || !productId) {
      return NextResponse.json({ error: 'Missing databaseId or productId' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();

    // Load Cin7 credentials
    const connRows = await sheets.getData(databaseId, 'Connections') as string[][];
    if (!connRows || connRows.length < 2) {
      return NextResponse.json({ error: 'Cin7 credentials not configured.' }, { status: 400 });
    }
    const hdrs = connRows[0] as string[];
    const vals = connRows[1] as string[];
    const accountId = vals[hdrs.indexOf('Cin7AccountId')] || '';
    const encApiKey = vals[hdrs.indexOf('Cin7ApiKey')] || '';
    const apiKey = encApiKey ? decrypt(encApiKey) : '';

    if (!accountId || !apiKey) {
      return NextResponse.json({ error: 'Cin7 Account ID and API Key are required.' }, { status: 400 });
    }

    const authHeader = `Basic ${Buffer.from(`${accountId}:${apiKey}`).toString('base64')}`;

    // Cin7 requires id to be a Number, not a string — string IDs are silently ignored
    const numericProductId = Number(productId);
    if (!numericProductId || isNaN(numericProductId)) {
      return NextResponse.json({ error: `Invalid productId: ${productId}` }, { status: 400 });
    }

    // ── Step 1: Build the product update payload ───────────────────────────────
    const updatePayload: any = { id: numericProductId };
    if (title?.trim()) updatePayload.name = title.trim();
    if (cin7Description?.trim()) updatePayload.description = cin7Description.trim().slice(0, 220);

    const putRes = await fetchWithRetry(
      `${CIN7_BASE}/Products`,
      {
        method: 'PUT',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([updatePayload]),
      },
    );

    if (!putRes.ok) {
      const errText = await putRes.text();
      return NextResponse.json(
        { error: `Cin7 API error (HTTP ${putRes.status}): ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const putBody = await putRes.json();
    const result = Array.isArray(putBody) ? putBody[0] : putBody;

    if (!result) {
      return NextResponse.json({ error: 'Cin7 returned an empty response — product ID may not exist in Cin7.' }, { status: 400 });
    }
    if (result?.success === false) {
      const errMsg = (result.errors ?? []).join('; ') || 'Unknown Cin7 error';
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    // ── Step 2: Set Online = -4 in the Products Google Sheet ──────────────────
    // Marks the product as pushed to website, pending Shopify confirmation.
    let tagSheetMsg = '';
    try {
      const configRows = await sheets.getData(databaseId, 'Config!A:B') as string[][];
      const getConfig = (key: string) => configRows?.find(r => r[0] === key)?.[1] ?? '';
      const inventorySystemId = getConfig('Inventory System') || databaseId;

      const productRows = await sheets.getData(inventorySystemId, 'Products') as string[][];
      if (productRows && productRows.length > 1 && styleCode) {
        // Find the row index for this styleCode (column B = index 1)
        const rowIdx = productRows.findIndex((r, i) => i > 0 && r[1] === styleCode);
        if (rowIdx > 0) {
          // rowIdx is 0-based in the array; row 0 is the header, so sheet row = rowIdx + 1
          // Set online = -4 (marks product as pushed to website, pending Shopify confirmation)
          await sheets.updateData(inventorySystemId, `Products!F${rowIdx + 1}`, [['-4']]);
          tagSheetMsg = ` Set Online=-4 in Products sheet (row ${rowIdx + 1}).`;
        } else {
          tagSheetMsg = ` Warning: styleCode "${styleCode}" not found in Products sheet — Online column not updated.`;
          console.warn(`[push-to-cin7] styleCode "${styleCode}" not found in Products sheet (inventorySystemId: ${inventorySystemId})`);
        }
      } else if (!styleCode) {
        tagSheetMsg = ' Warning: no styleCode provided — Products sheet not updated.';
      }
    } catch (tagErr: any) {
      console.warn('[push-to-cin7] Products sheet update failed:', tagErr.message);
      tagSheetMsg = ` Warning: Products sheet update failed — ${tagErr.message}`;
    }

    // ── Step 3: Download images and save to "Website Images" folder in Drive ──
    // Files are named {styleCode}_1.jpg, {styleCode}_2.jpg, etc. so Cin7 can
    // match them to products during a bulk image import.  Up to 3 images saved.
    let imageSheetMsg = '';
    if (Array.isArray(images) && images.length > 0 && styleCode) {
      try {
        const config = await sheets.getData(databaseId, 'Config!A:B') as string[][];
        const folderId = config?.find(r => r[0] === 'FolderID')?.[1];
        if (folderId) {
          const websiteImagesFolderId = await sheets.findOrCreateFolder('Website Images', folderId);
          const validImages = images.filter((u: string) => u?.trim()?.startsWith('http')).slice(0, 3);
          let savedCount = 0;
          for (let i = 0; i < validImages.length; i++) {
            try {
              const imgRes = await fetchWithTimeout(validImages[i]);
              if (!imgRes.ok) continue;
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const ext = contentType.includes('png') ? 'png'
                : contentType.includes('gif') ? 'gif'
                : contentType.includes('webp') ? 'webp'
                : 'jpg';
              const buffer = await imgRes.arrayBuffer();
              const base64 = Buffer.from(buffer).toString('base64');
              const filename = `${styleCode}_${i + 1}.${ext}`;
              await sheets.uploadFileToDrive(base64, contentType, filename, websiteImagesFolderId);
              savedCount++;
            } catch (singleErr: any) {
              console.warn(`[push-to-cin7] Image ${i + 1} upload failed:`, singleErr.message);
            }
          }
          imageSheetMsg = savedCount > 0
            ? ` ${savedCount} image${savedCount !== 1 ? 's' : ''} saved to "Website Images" folder.`
            : ' (Images found but could not be downloaded/uploaded.)';
        } else {
          imageSheetMsg = ' (FolderID not set in Config — images not saved.)';
        }
      } catch (imgErr: any) {
        console.warn('[push-to-cin7] Website Images folder save failed:', imgErr.message);
        imageSheetMsg = ` (Image save failed — ${imgErr.message})`;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Pushed to Cin7.${tagSheetMsg}${imageSheetMsg}`,
    });
  } catch (e: any) {
    console.error('[push-to-cin7]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
