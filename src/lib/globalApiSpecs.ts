import { GoogleSheetsService } from '@/services/GoogleSheetsService';

/**
 * The APIConnectionSpecs spreadsheet is a single global sheet (not per-business)
 * that stores API instructions and schemas for all integrated APIs.
 * It lives in the shared Drive folder alongside all business databases.
 *
 * Set GLOBAL_SPECS_FOLDER_ID in your environment to override the default folder.
 */

const SHEET_NAME = 'APIConnectionSpecs';
const FOLDER_ID  = process.env.GLOBAL_SPECS_FOLDER_ID || '0AIH8muFbEdEOUk9PVA';

// Module-level cache: survives for the lifetime of the Node.js process.
// On cold start / redeploy it simply does one Drive search and caches the result.
let _cachedId: string | null = null;

export async function getGlobalSpecsSheetId(sheets: GoogleSheetsService): Promise<string> {
  if (_cachedId) return _cachedId;
  _cachedId = await sheets.findOrCreateSpreadsheet(SHEET_NAME, FOLDER_ID);
  return _cachedId;
}
