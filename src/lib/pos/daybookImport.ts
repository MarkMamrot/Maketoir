import crypto from 'node:crypto';
import { parseDaybookDate, shouldImportNewtownCommunication } from './daybookService';

export type ImportedTask = { phase: 'opening' | 'during_day' | 'closing'; title: string; recurrence: 'daily' | 'weekly'; weekday?: number; signoffs: { date: string; initials: string }[] };
export type ImportedCommunication = { date: string; message: string; reads: { name: string; initials: string }[]; importKey: string };
export type ImportedRecord = { type: 'customer_request' | 'store_need' | 'stock_discrepancy' | 'incident'; date: string | null; title: string; details: Record<string, unknown>; staffInitials: string; importKey: string };
export type ImportedReference = { category: string; title: string; content: string; importKey: string };
export type ImportedGuide = { sku: string; productName: string; category: string; shelf: string; status: string; importKey: string };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(cell.trim()); cell = ''; }
    else if (character === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else if (character !== '\r') cell += character;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

const SECRET_PATTERNS = [
  /\bpassword\s*[:=-]?\s*\S+/gi,
  /\bpin(?:\s+number)?\s*[:=-]?\s*\d+/gi,
  /\b(pos|register|location)\s+(id|key|code)\s*[:=-]?\s*\S+/gi,
  /\bnetwork\s+(name|password)\s*[:=-]?\s*\S+/gi,
];

export function sanitizeImportedText(value: string): { text: string; redactions: number } {
  let text = value;
  let redactions = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => { redactions += 1; return '[secure details removed]'; });
  }
  return { text: text.trim(), redactions };
}

function key(prefix: string, ...parts: unknown[]) {
  return `${prefix}:${crypto.createHash('sha256').update(parts.map(String).join('|')).digest('hex').slice(0, 32)}`;
}

function initials(value: string) {
  return value.trim().match(/[a-z]{1,8}/i)?.[0]?.toUpperCase() ?? '';
}

export function parseCommunications(text: string): { records: ImportedCommunication[]; skippedBefore2026: number } {
  const rows = parseCsv(text);
  const names = rows[0]?.slice(2).map(value => value.trim()) ?? [];
  const records: ImportedCommunication[] = [];
  let skippedBefore2026 = 0;
  for (const row of rows.slice(1)) {
    const date = parseDaybookDate(row[0] ?? '');
    const message = (row[1] ?? '').trim();
    if (date && message) {
      if (!shouldImportNewtownCommunication(date)) { skippedBefore2026 += 1; continue; }
      const clean = sanitizeImportedText(message).text;
      records.push({ date, message: clean, reads: row.slice(2).map((value, index) => ({ name: names[index] || initials(value), initials: initials(value) })).filter(read => read.initials), importKey: key('newtown-comms', date, clean) });
    } else if (message && records.length) {
      const clean = sanitizeImportedText(message).text;
      records[records.length - 1].message += `\n${clean}`;
    }
  }
  return { records, skippedBefore2026 };
}

export function parseStartEndTasks(text: string): { tasks: ImportedTask[]; redactions: number } {
  const rows = parseCsv(text);
  const tasks: ImportedTask[] = [];
  let phase: ImportedTask['phase'] = 'opening';
  let dateColumns: { index: number; date: string }[] = [];
  let redactions = 0;
  for (const row of rows) {
    if (row.some(cell => cell.includes('END OF DAY'))) phase = 'closing';
    const dates = row.map((cell, index) => ({ index, date: parseDaybookDate(cell) })).filter(item => item.date) as { index: number; date: string }[];
    if (dates.length >= 2) { dateColumns = dates; continue; }
    const rawTitle = (row[2] ?? '').trim();
    if (!rawTitle || rawTitle === 'DAY' || rawTitle === 'DATE' || !dateColumns.length) continue;
    const clean = sanitizeImportedText(rawTitle); redactions += clean.redactions;
    tasks.push({ phase, title: clean.text, recurrence: 'daily', signoffs: dateColumns.map(item => ({ date: item.date, initials: initials(row[item.index] ?? '') })).filter(item => item.initials) });
  }
  return { tasks, redactions };
}

export function parseWeekly(text: string): { tasks: ImportedTask[]; references: ImportedReference[]; guides: ImportedGuide[] } {
  const rows = parseCsv(text);
  const tasks: ImportedTask[] = [];
  const references: ImportedReference[] = [];
  const guides = new Map<string, ImportedGuide>();
  const weekdays: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  let weekday = 1;
  let taskDate: string | null = null;
  let shelf = '';
  let category = '';
  for (const row of rows) {
    const day = (row[1] ?? '').trim().toLowerCase();
    if (day in weekdays) { weekday = weekdays[day]; taskDate = parseDaybookDate(row[3] ?? ''); }
    const taskTitle = (row[2] ?? '').trim().replace(/^[-–]\s*/, '');
    if (taskTitle && !/^KYDS$/i.test(taskTitle) && !/^\d+(st|nd|rd|th) SHELF/i.test(taskTitle) && !/^KYD\d+/i.test(row[1] ?? '')) {
      tasks.push({ phase: 'during_day', title: sanitizeImportedText(taskTitle).text, recurrence: 'weekly', weekday, signoffs: taskDate && initials(row[4] ?? '') ? [{ date: taskDate, initials: initials(row[4]) }] : [] });
    }
    const supply = (row[7] ?? '').trim().replace(/^[-–]\s*/, '');
    if (supply && !/slow day|research products|pick a space|practice|dust|check to make/i.test(supply) && !/Store Needs Checklist|From IGA/i.test(supply)) {
      references.push({ category: 'Store needs catalogue', title: supply, content: 'Common consumable or supply request', importKey: key('newtown-supply', supply) });
    }
    const descriptor = (row[2] ?? '').trim();
    if (/SHELF/i.test(descriptor)) shelf = descriptor;
    else if (/animals|dogs|cats|dinosaurs|fluffies|birds/i.test(descriptor) && !/^KYD/i.test(row[1] ?? '')) category = descriptor.replace(/\s*\(.*$/, '').replace(/:$/, '');
    const sku = (row[1] ?? '').trim().toUpperCase();
    if (/^KYD\d+/.test(sku) && descriptor) guides.set(sku, { sku, productName: descriptor, category, shelf, status: (row[3] ?? '').trim() || 'active', importKey: key('newtown-kyds', sku) });
  }
  return { tasks, references, guides: [...guides.values()] };
}

export function parseCustomerRequests(text: string): ImportedRecord[] {
  return parseCsv(text).flatMap(row => {
    const date = parseDaybookDate(row[0] ?? '');
    if (!date || !(row[1] ?? '').trim()) return [];
    const title = `${row[1]} - ${row[3] || 'Customer request'}`.slice(0, 255);
    return [{ type: 'customer_request' as const, date, title, details: { customer_name: row[1], contact_details: row[2], item: row[3], notes: row[4], contact_outcome: row[5] }, staffInitials: 'IMP', importKey: key('newtown-request', date, title) }];
  });
}

export function parseDiscrepancies(text: string): ImportedRecord[] {
  return parseCsv(text).flatMap(row => {
    const date = parseDaybookDate(row[0] ?? '');
    if (!date || !(row[1] ?? '').trim()) return [];
    return [{ type: 'stock_discrepancy' as const, date, title: (row[2] || row[1]).slice(0, 255), details: { sku: row[1], item: row[2], size: row[3], system_quantity: Number(row[4]), physical_quantity: Number(row[5]), variance: Number(row[6]), notes: row[10] }, staffInitials: initials(row[7]) || 'IMP', importKey: key('newtown-discrepancy', date, row[1]) }];
  });
}

export function parseStoreNeeds(text: string): ImportedRecord[] {
  const output: ImportedRecord[] = [];
  for (const row of parseCsv(text).slice(2)) {
    const leftDate = parseDaybookDate(row[0] ?? '');
    if (leftDate && row[1]) output.push({ type: 'store_need', date: leftDate, title: row[1].slice(0, 255), details: { item: row[1], warehouse_notes: row[2], request_kind: 'consumable' }, staffInitials: 'IMP', importKey: key('newtown-need', leftDate, row[1]) });
    const rightDate = parseDaybookDate(row[4] ?? '');
    if (rightDate && (row[5] || row[6])) output.push({ type: 'store_need', date: rightDate, title: (row[6] || row[5]).slice(0, 255), details: { sku: row[5], item: row[6], size: row[7], quantity: row[8], warehouse_notes: row[9], store_notes: row[10], request_kind: 'stock' }, staffInitials: 'IMP', importKey: key('newtown-need', rightDate, row[5], row[6]) });
  }
  return output;
}

export function parseIncidents(text: string): ImportedRecord[] {
  return parseCsv(text).flatMap(row => {
    const dateText = (row[0] ?? '').match(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/)?.[0] ?? '';
    const date = parseDaybookDate(dateText);
    if (!date || !(row[3] ?? '').trim()) return [];
    return [{ type: 'incident' as const, date, title: `Incident on ${date}`, details: { time: row[1], staff_present: row[2], event_description: row[3], loss_or_damage: row[4], emergency_services: row[5], instigator_description: row[6], management_notified: row[7], report_made: row[8], signed: row[9] }, staffInitials: initials(row[9]) || 'IMP', importKey: key('newtown-incident', date, row[1], row[3]) }];
  });
}

export function parseSafeReferences(text: string): { references: ImportedReference[]; rejectedRows: number } {
  const rows = parseCsv(text);
  const references: ImportedReference[] = [];
  let rejectedRows = 0;
  for (const row of rows) {
    if (/password|\bpin\b|login|key:|location code|network name|username/i.test(row.join(' '))) rejectedRows += 1;
    const contactName = (row[1] ?? '').trim();
    const contactDetails = [row[2], row[3]].filter(Boolean).join(' · ');
    if (contactName && contactDetails && !/password|login|username|pin/i.test(`${contactName} ${contactDetails}`)) references.push({ category: 'Contacts', title: contactName, content: contactDetails, importKey: key('newtown-contact', contactName) });
    const storeName = (row[5] ?? '').trim();
    const storeDetails = [row[6], row[7]].filter(Boolean).join(' · ');
    if (storeName && storeDetails && !/password|login|username|pin/i.test(`${storeName} ${storeDetails}`)) references.push({ category: 'Stores', title: storeName, content: storeDetails, importKey: key('newtown-store', storeName) });
    const coin = (row[15] ?? '').trim();
    if (/roll/i.test(coin)) references.push({ category: 'Coin roll guide', title: coin, content: [row[16], row[17]].filter(Boolean).join(' · '), importKey: key('newtown-coins', coin) });
  }
  return { references: [...new Map(references.map(item => [item.importKey, item])).values()], rejectedRows };
}

export function sourceChecksum(files: { name: string; text: string }[]): string {
  return crypto.createHash('sha256').update(files.sort((a, b) => a.name.localeCompare(b.name)).map(file => `${file.name}\0${file.text}`).join('\0')).digest('hex');
}