import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsImagesRepo } from '@/lib/ims/ImsRepository';
import { imsQuery, imsExecute } from '@/services/IMSMySQLService';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try { return JSON.parse(c.value); } catch { return null; }
}

const SETTING_KEY = 'images_drive_folder_id';
const FOLDER_NAME = 'IMS Product Images';
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_TYPES  = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** Get or create the Drive folder for this business, storing the ID in ims_settings. */
async function getOrCreateFolder(businessId: string, sheets: GoogleSheetsService): Promise<string> {
  const rows = await imsQuery<{ value: string }>(
    `SELECT value FROM ims_settings WHERE business_id = ? AND \`key\` = ?`,
    [businessId, SETTING_KEY],
  );
  if (rows[0]?.value) return rows[0].value;

  // Create folder at Drive root (no parent) — service account root
  const folderId = await sheets.createFolder(FOLDER_NAME);
  await imsExecute(
    `INSERT INTO ims_settings (business_id, \`key\`, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [businessId, SETTING_KEY, folderId],
  );
  return folderId;
}

/**
 * POST /api/ims/products/[id]/images/upload
 * Body: multipart/form-data  { file: File, alt_text?: string, is_primary?: '1'|'0' }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ success: false, error: 'No file provided.' }, { status: 400 });

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ success: false, error: 'Only JPEG, PNG, WebP and GIF are allowed.' }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ success: false, error: 'File exceeds 8 MB limit.' }, { status: 400 });
    }

    const altText   = (formData.get('alt_text') as string | null) ?? undefined;
    const isPrimary = formData.get('is_primary') === '1';

    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Get or create Drive folder for this business
    const sheets   = new GoogleSheetsService();
    const folderId = await getOrCreateFolder(session.userSpreadsheetId, sheets);

    // Upload to Drive, get public URL
    const ext      = file.type.split('/')[1] ?? 'jpg';
    const filename = `${params.id}-${Date.now()}.${ext}`;
    const url      = await sheets.uploadFileToDrive(base64, file.type, filename, folderId);

    // Extract Drive file ID from URL for future reference
    const driveFileId = url.match(/[?&]id=([^&]+)/)?.[1];

    // Save record in IMS
    const imageId = await ImsImagesRepo.add(params.id, url, 'google_drive', {
      driveFileId,
      altText,
      isPrimary,
    });

    return NextResponse.json({ success: true, id: imageId, url });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
