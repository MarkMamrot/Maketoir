/**
 * POST /api/website/bulk-edit/preview
 *
 * Two-phase design:
 *
 * Phase 1 — Initialise (only on first call, or after a manual reset):
 *   Copies every product from Shopify_Products into BulkEdit_Review with
 *   status = "queued", filling old_description and old_tags from the live
 *   sheet. new_description / new_tags are left blank until AI fills them in.
 *
 * Phase 2 — Process (runs every call, including the first):
 *   Picks the next `batchSize` rows that still have status "queued".
 *   Runs one AI call per product (generating all requested fields together).
 *   Updates those rows in-place: writes new content and flips status to
 *   "pending" (ready for the user to review, then commit to Shopify).
 *
 * The user clicks "Generate Previews" repeatedly until remaining = 0.
 * Non-queued rows (pending / committed / failed) are always skipped.
 *
 * Body: {
 *   databaseId: string,
 *   fields: ('description' | 'tags')[],
 *   batchSize: number,           // how many queued products to process this run (1-100)
 *   extraContext: string,        // extra instructions to pass to AI
 *   useExisting: boolean,        // consider current descriptions when rewriting
 *   useCompetitor: boolean,      // allow AI to draw on category competitor knowledge
 * }
 */
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { GoogleGenAI } from '@google/genai';

const REVIEW_SHEET = 'BulkEdit_Review';
const REVIEW_HEADERS = [
  'product_id', 'product_title', 'variant_summary',
  'old_description', 'new_description',
  'old_tags', 'new_tags',
  'status', 'committed_at', 'error',
  'new_title',
];

// Column indices within BulkEdit_Review rows (0-based, matches REVIEW_HEADERS)
const RC = {
  product_id:  0,
  title:       1,  // also serves as old_title
  variant:     2,
  old_desc:    3,
  new_desc:    4,  // col E — written by AI
  old_tags:    5,
  new_tags:    6,  // col G — written by AI
  status:      7,  // col H
  new_title:   10, // col K — written by AI
};

// Column indices in Shopify_Products (must match ShopifyService.PRODUCT_HEADERS)
const PC = { id: 0, title: 3, status: 4, product_type: 5, vendor: 6, tags: 7, description: 8, price: 9, sku: 11, image_url: 15 };

function errMsg(e: any): string {
  if (e?.errors?.[0]?.message) return e.errors[0].message;
  if (e?.message) return e.message;
  try { return JSON.stringify(e); } catch { return 'Unknown error'; }
}

async function getWebsiteSheetId(sheets: GoogleSheetsService, databaseId: string): Promise<string | null> {
  try {
    const config = await sheets.getData(databaseId, 'Config!A:B');
    const row = (config as string[][]).find(r => r[0] === 'WebsiteSheetId');
    return row?.[1] || null;
  } catch { return null; }
}

async function getWebContentTemplates(sheets: GoogleSheetsService, websiteSheetId: string): Promise<{ description: any | null; title: any | null; tags: any | null }> {
  const empty = { description: null, title: null, tags: null };
  try {
    const data = await sheets.getData(websiteSheetId, 'ProductDescTemplate!A:B') as string[][];
    if (!data || data.length < 2) return empty;

    const dataRows = data.slice(1);
    // Back-compat: old format had 'Timestamp' in column A of row 2
    if (dataRows[0]?.[0]?.trim() === 'Timestamp') {
      const jsonStr = dataRows[0][1]?.trim();
      if (jsonStr) {
        try { return { ...empty, description: JSON.parse(jsonStr) }; } catch { /* corrupt */ }
      }
      return empty;
    }

    const result = { ...empty };
    for (const row of dataRows) {
      const key = row[0]?.trim() as 'description' | 'title' | 'tags';
      const val = row[1]?.trim();
      if (key && val && key in result) {
        try { (result as any)[key] = JSON.parse(val); } catch { /* corrupt */ }
      }
    }
    return result;
  } catch { /* sheet not yet created */ }
  return empty;
}

/** Fetch a public image URL and return { base64, mimeType }, or null on failure. */
async function fetchImageAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  if (!url?.startsWith('http')) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const mimeType = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    return { base64: Buffer.from(buffer).toString('base64'), mimeType };
  } catch { return null; }
}

async function getBrandProfile(sheets: GoogleSheetsService, databaseId: string): Promise<string> {
  try {
    const data = await sheets.getData(databaseId, 'BrandProfile!A:T');
    if (!data || data.length < 2) return '';
    const row = data[1] as string[];
    return [
      row[1] ? `Mission: ${row[1]}` : '',
      row[2] ? `Unique Value Proposition: ${row[2]}` : '',
      row[3] ? `Brand Tone: ${row[3]}` : '',
      row[4] ? `Target Audience: ${row[4]}` : '',
      row[5] ? `Geographic Markets: ${row[5]}` : '',
      row[6] ? `Products: ${row[6]}` : '',
      row[7] ? `Pricing: ${row[7]}` : '',
      row[8] ? `Customer Praises: ${row[8]}` : '',
      row[9] ? `Customer Objections: ${row[9]}` : '',
      row[10] ? `Competitors: ${row[10]}` : '',
      row[11] ? `Market Gap: ${row[11]}` : '',
      row[12] ? `Logo URL: ${row[12]}` : '',
      row[14] ? `Shipping Policy: ${row[14]}` : '',
      row[15] ? `Connected Software: ${row[15]}` : '',
      row[16] ? `Operations Summary: ${row[16]}` : '',
      row[17] ? `Returns Policy: ${row[17]}` : '',
      row[18] ? `Brand History: ${row[18]}` : '',
      row[19] ? `Physical Branches: ${row[19]}` : '',
    ].filter(Boolean).join('\n');
  } catch { return ''; }
}

function buildPrompt(
  product: {
    product_id: number;
    title: string;
    current_tags: string;
    current_description?: string;
  },
  descTemplate: any | null,
  brandProfile: string,
  fields: string[],
  useExisting: boolean,
  useCompetitor: boolean,
  extraContext: string,
  titleSchema: any | null,
  tagsSchema: any | null,
): string {
  const doTitle = fields.includes('title');
  const doDesc  = fields.includes('description');
  const doTags  = fields.includes('tags');

  let p = `You are an expert eCommerce copywriter.\n\n`;

  if (brandProfile) p += `BRAND:\n${brandProfile}\n\n`;

  if (doDesc && descTemplate) {
    const headingTag: string | undefined    = descTemplate.headingTag;
    const headingColour: string | undefined = descTemplate.headingColour;
    const bulletChar: string | undefined    = descTemplate.bulletChar;
    const bulletColour: string | undefined  = descTemplate.bulletColour;

    p += `DESCRIPTION TEMPLATE TO FOLLOW:\nTone: ${descTemplate.toneGuide}\n`;
    if (descTemplate.writingRules?.length) {
      p += `Writing rules:\n${(descTemplate.writingRules as string[]).map((r: string) => `- ${r}`).join('\n')}\n`;
    }

    // ── HTML generation rules (only added if explicitly configured in template) ──
    const htmlLines: string[] = [];

    if (headingTag || headingColour) {
      const tag = headingTag ?? 'h3';
      const open = headingColour ? `<${tag} style="color:${headingColour}">` : `<${tag}>`;
      const close = `</${tag}>`;
      htmlLines.push(`- Section headings: always use ${open}Heading Text${close} — no other heading tags, no deviation.`);
    }

    if (bulletColour || bulletChar) {
      const char = bulletChar ?? '\u2713';
      if (bulletColour) {
        const bulletListRule =
          `<ul style="list-style:none;padding:0;margin:0 0 14px 0;">` +
          `<li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;">` +
          `<span style="color:${bulletColour};font-weight:bold;flex-shrink:0;">${char}</span>` +
          `<span>Item text here</span></li></ul>`;
        htmlLines.push(`- Bullet lists: use this exact pattern (never plain <ul><li>):\n  ${bulletListRule}`);
        htmlLines.push(`- No CSS classes. Inline styles only as shown above.`);
      } else {
        htmlLines.push(`- Every list item MUST start with "${char}" — e.g. <li>${char} Feature text here</li>`);
      }
    }

    if (htmlLines.length > 0) {
      p += `\nHTML rules (STRICT — follow exactly, no exceptions):\n`;
      p += htmlLines.join('\n') + '\n';
      p += `- Body text: <p>...</p>\n`;
      p += `- Callout / badge text: <strong>...</strong>\n\n`;
    }

    // Build heading open/close for the field list hints
    const hTag = headingTag ?? 'h3';
    const hOpen = headingColour ? `<${hTag} style="color:${headingColour}">` : `<${hTag}>`;
    const hClose = `</${hTag}>`;

    p += `Template fields (generate HTML with these sections in this order):\n`;
    for (const f of (descTemplate.fields ?? [])) {
      const hasLabel = f.label?.trim();
      const isDynamicHeadingField = !hasLabel && /heading/i.test(String(f.name ?? ''));
      const headingExample = hasLabel
        ? ` — heading: ${hOpen}${f.label}${hClose}`
        : isDynamicHeadingField
          ? ` — heading: use this field value itself as the heading text: ${hOpen}[value from this field]${hClose}`
          : ' — no heading for this section';
      p += `- "${hasLabel || f.name}"${f.maxLength ? ` (max ${f.maxLength} chars)` : ''}${f.count ? ` (${f.count} items)` : ''}${headingExample}: ${f.format}\n`;
    }
    p += `\n`;
  } else if (doDesc) {
    p += `Generate clean, compelling HTML product descriptions. Use <h3> for section headings, <p> for paragraphs, <ul><li> for key features.\n\n`;
  }

  if (useExisting && doDesc && product.current_description) {
    p += `EXISTING DESCRIPTION (preserve accurate product-specific details and build upon them to match the template):\n${product.current_description}\n\n`;
  }

  if (useExisting && doTags && (product as any).current_tags_existing) {
    p += `EXISTING TAGS (reference these when building the new tag set — keep accurate ones, improve or add as needed):\n${(product as any).current_tags_existing}\n\n`;
  }

  if (useExisting && doTitle && (product as any).current_title) {
    p += `EXISTING TITLE (refine this rather than starting from scratch if it is already close):\n${(product as any).current_title}\n\n`;
  }

  if (useCompetitor) {
    p += `COMPETITOR CONTEXT: You may draw on your knowledge of how similar products are described by major retailers to ensure completeness. STRICT RULES: Only include information that clearly applies to this exact product. Never assume or fabricate specs. When in doubt, omit — our own product data takes priority.\n\n`;
  }

  if (extraContext?.trim()) {
    p += `ADDITIONAL INSTRUCTIONS FROM SELLER:\n${extraContext.trim()}\n\n`;
  }

  if (doTitle) {
    if (titleSchema) {
      p += `TITLE SCHEMA TO FOLLOW:\nTone: ${titleSchema.toneGuide}\nMax length: ${titleSchema.maxLength} characters\n`;
      if (titleSchema.formatRules?.length) {
        p += `Rules:\n${(titleSchema.formatRules as string[]).map((r: string) => `- ${r}`).join('\n')}\n`;
      }
      if (titleSchema.formulaExamples?.length) {
        p += `Formula examples: ${(titleSchema.formulaExamples as string[]).join(' | ')}\n`;
      }
      p += `\n`;
    } else {
      p += `TITLE GUIDELINES: Write a clear, concise product title that includes the key product name, primary differentiator, and variant context if relevant. Match the brand tone. Keep under 80 characters where possible.\n\n`;
    }
  }

  if (doTags && tagsSchema) {
    p += `TAGS SCHEMA TO FOLLOW:\n${tagsSchema.instructions}\n`;
    if (tagsSchema.requiredTags?.length) {
      p += `Required tags (always include): ${(tagsSchema.requiredTags as string[]).join(', ')}\n`;
    }
    if (tagsSchema.excludedTerms?.length) {
      p += `Excluded terms (never use): ${(tagsSchema.excludedTerms as string[]).join(', ')}\n`;
    }
    p += `\n`;
  }

  p += `OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown code fences, no explanation):\n`;
  p += `{\n  "product_id": ${product.product_id}`;
  if (doTitle) p += `,\n  "new_title": "New product title"`;
  if (doDesc)  p += `,\n  "new_description_html": "<h2>...</h2><p>...</p>"`;
  if (doTags)  p += `,\n  "new_tags": "tag1, tag2, tag3"`;
  p += `\n}\n\n`;

  p += `PRODUCT:\n${JSON.stringify(product, null, 2)}`;
  return p;
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) {
    return new Response(JSON.stringify({ error: 'Not authenticated.' }), { status: 401 });
  }

  const {
    databaseId,
    fields,
    batchSize = 10,
    extraContext = '',
    useExisting = true,
    useCompetitor = true,
    useImages = true,
    useTemplates = true,
  } = await req.json() as {
    databaseId: string;
    fields: string[];
    batchSize?: number;
    extraContext?: string;
    useExisting?: boolean;
    useCompetitor?: boolean;
    useImages?: boolean;
    useTemplates?: boolean;
  };

  if (!databaseId || !fields?.length) {
    return new Response(JSON.stringify({ error: 'databaseId and fields are required.' }), { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured.' }), { status: 500 });
  }

  const safeSize = Math.min(Math.max(Number(batchSize) || 10, 1), 100);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const sheets = new GoogleSheetsService();
        const ai = new GoogleGenAI({ apiKey });

        // Resolve Gemini model preference
        let modelId = 'gemini-2.5-flash-preview-04-17';
        try {
          const connRows = await sheets.getData(databaseId, 'Connections');
          if (connRows && connRows.length >= 2) {
            const hi = (connRows[0] as string[]).indexOf('GeminiModel');
            if (hi >= 0 && (connRows[1] as string[])[hi]) modelId = (connRows[1] as string[])[hi];
          }
        } catch { /* use default */ }

        // ── Resolve website sheet ─────────────────────────────────────────
        const websiteSheetId = await getWebsiteSheetId(sheets, databaseId);
        if (!websiteSheetId) {
          emit({ status: 'error', error: 'Website sheet not found. Sync Shopify products first.' });
          controller.close(); return;
        }

        const reviewUrl = `https://docs.google.com/spreadsheets/d/${websiteSheetId}`;

        // ── Phase 1: Initialise BulkEdit_Review if not yet populated ──────
        let reviewData: string[][] = [];
        try {
          const raw = await sheets.getData(websiteSheetId, REVIEW_SHEET) as string[][];
          if (raw && raw.length > 1) reviewData = raw;
        } catch { /* sheet doesn't exist yet */ }

        if (reviewData.length === 0) {
          emit({ status: 'loading', message: 'First run — reading all products from Shopify_Products…' });

          const productRows = await sheets.getData(websiteSheetId, 'Shopify_Products') as string[][];
          if (!productRows || productRows.length < 2) {
            emit({ status: 'error', error: 'No products in Shopify_Products sheet. Sync Shopify products first.' });
            controller.close(); return;
          }

          const allProducts = productRows.slice(1).filter(r => r[PC.id]?.trim());
          if (!allProducts.length) {
            emit({ status: 'error', error: 'No products with IDs found in sheet.' });
            controller.close(); return;
          }

          emit({ status: 'loading', message: `Copying ${allProducts.length} products to review sheet as queued…` });

          await sheets.resetSheet(websiteSheetId, REVIEW_SHEET, REVIEW_HEADERS);

          const initRows: string[][] = allProducts.map(row => [
            row[PC.id]?.trim() ?? '',
            row[PC.title] ?? '',
            `$${row[PC.price] || '0'} | SKU: ${row[PC.sku] || 'N/A'}`,
            row[PC.description] ?? '',  // old_description
            '',                          // new_description — filled by AI
            row[PC.tags] ?? '',          // old_tags
            '',                          // new_tags — filled by AI
            'queued',
            '',
            '',
          ]);

          const CHUNK = 500;
          for (let c = 0; c < initRows.length; c += CHUNK) {
            await sheets.appendData(websiteSheetId, `${REVIEW_SHEET}!A:J`, initRows.slice(c, c + CHUNK));
          }

          emit({ status: 'loading', message: `All ${allProducts.length} products queued. Starting first batch…` });

          const fresh = await sheets.getData(websiteSheetId, REVIEW_SHEET) as string[][];
          reviewData = fresh && fresh.length > 1 ? fresh : [];
        }

        // ── Phase 2: Find and process next batch of queued rows ───────────
        // sheetRow is 1-based; header = row 1, data starts at row 2.
        const queuedRows = reviewData
          .slice(1)
          .map((row, i) => ({ row, sheetRow: i + 2 }))
          .filter(({ row }) => row[RC.status] === 'queued');

        const totalProducts = reviewData.length - 1;

        if (!queuedRows.length) {
          emit({ status: 'done', processed: 0, remaining: 0, total: totalProducts, reviewUrl, allDone: true });
          controller.close(); return;
        }

        const toProcess = queuedRows.slice(0, safeSize);
        const remaining = queuedRows.length - toProcess.length;

        emit({ status: 'loading', message: `Preparing AI context…` });

        const [webTemplates, brandProfile, shopifyProductRows] = await Promise.all([
          useTemplates ? getWebContentTemplates(sheets, websiteSheetId) : Promise.resolve({ description: null, title: null, tags: null }),
          getBrandProfile(sheets, databaseId),
          sheets.getData(websiteSheetId, 'Shopify_Products').catch(() => null) as Promise<string[][] | null>,
        ]);
        const { description: descTemplate, title: titleSchema, tags: tagsSchema } = webTemplates;

        // Build productId -> imageUrl lookup from the live Shopify_Products sheet
        const imageUrlMap = new Map<string, string>();
        if (shopifyProductRows && shopifyProductRows.length > 1) {
          for (const row of shopifyProductRows.slice(1)) {
            const pid = row[PC.id]?.trim();
            const img = row[PC.image_url]?.trim();
            if (pid && img) imageUrlMap.set(pid, img);
          }
        }

        if (fields.includes('description') && !descTemplate) {
          emit({ status: 'loading', message: 'No description template saved — using brand profile only. Generate a template first for best results.' });
        }

        // ── Process each product individually ─────────────────────────────
        let processed = 0;
        let errors = 0;

        for (const { row, sheetRow } of toProcess) {
          const productId = row[RC.product_id];
          const title = row[RC.title] || `Product ${productId}`;

          emit({ status: 'progress', processed: processed + 1, total: toProcess.length, title });

          const productPayload = {
            product_id: Number(productId),
            title,
            current_tags: row[RC.old_tags] || '',
            ...(useExisting && fields.includes('description') && row[RC.old_desc]
              ? { current_description: row[RC.old_desc].substring(0, 800) }
              : {}),
            ...(useExisting && fields.includes('tags') && row[RC.old_tags]
              ? { current_tags_existing: row[RC.old_tags] }
              : {}),
            ...(useExisting && fields.includes('title') && title
              ? { current_title: title }
              : {}),
          };

          try {
            const promptText = buildPrompt(productPayload, descTemplate, brandProfile, fields, useExisting, useCompetitor, extraContext, titleSchema, tagsSchema);

            // Build multimodal contents: text prompt + optional product image
            const imageUrl = useImages
              ? (imageUrlMap.get(String(productPayload.product_id)) || imageUrlMap.get(productId))
              : null;
            const imageData = imageUrl ? await fetchImageAsBase64(imageUrl) : null;

            const parts: any[] = [{ text: promptText }];
            if (imageData) {
              parts.push({ inlineData: { mimeType: imageData.mimeType, data: imageData.base64 } });
            }

            const result = await ai.models.generateContent({
              model: modelId,
              contents: [{ role: 'user', parts }],
            });
            let raw = result.text?.trim() ?? '';
            raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

            const item = JSON.parse(raw) as {
              product_id: number;
              new_title?: string;
              new_description_html?: string;
              new_tags?: string;
            };

            // Update columns E–H in-place (one API call per product).
            // F (old_tags) is rewritten to its existing value to keep the range contiguous.
            await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!E${sheetRow}:H${sheetRow}`, [[
              fields.includes('description') ? (item.new_description_html ?? '') : '',
              row[RC.old_tags] ?? '',  // F — preserve existing old_tags
              fields.includes('tags')  ? (item.new_tags ?? '')           : '',
              'pending',
            ]]);

            // Write new_title to col K if requested
            if (fields.includes('title') && item.new_title) {
              await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!K${sheetRow}`, [[item.new_title]]);
            }

            processed++;
          } catch (e: any) {
            // Mark as error in the sheet so the user can see it
            try {
              await sheets.updateData(websiteSheetId, `${REVIEW_SHEET}!H${sheetRow}:J${sheetRow}`, [
                ['error', '', errMsg(e).slice(0, 200)],
              ]);
            } catch { /* best-effort */ }
            emit({ status: 'product_error', title, error: errMsg(e) });
            errors++;
            processed++;
          }
        }

        emit({ status: 'done', processed, errors, remaining, total: totalProducts, reviewUrl, allDone: remaining === 0 });

      } catch (e: any) {
        emit({ status: 'error', error: errMsg(e) });
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
