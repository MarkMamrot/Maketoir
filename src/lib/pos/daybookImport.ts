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
  /\b(?:pw|pass)\s*[:=-]?\s*\S+/gi,
  /\bpin(?:\s+number)?\s*[:=-]?\s*\d+/gi,
  /\b(?:solvantis|eftpos|deposit|pos)[^\n,]{0,30}\bpin\s*[:=-]?\s*\d+/gi,
  /\b(pos|register|location)\s+(id|key|code)\s*[:=-]?\s*\S+/gi,
  /\blocation\s*[:=-]\s*\S+/gi,
  /\buser(?:name| name)\s*[:=-]?\s*\S+/gi,
  /\bnetwork\s+(name|password)\s*[:=-]?\s*\S+/gi,
];

const SENSITIVE_ROW_PATTERN = /\b(password|\bpw\b|\bpass\b|\bpin\b|login|username|location code|bank details?|\bbsb\b|account number|account name|deposit card|router|wi-?fi|modem|zeller|shopify|loyalty dog)\b/i;

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

function normalizedHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findHeader(rows: string[][], required: string[]) {
  return rows.findIndex(row => required.every(term => row.some(cell => normalizedHeader(cell).includes(term))));
}

function branchKey(branch: string, section: string, ...parts: unknown[]) {
  return key(`${branch.toLowerCase()}-${section}`, ...parts);
}

export function parseBranchStartEndTasks(text: string): { tasks: ImportedTask[]; redactions: number } {
  const rows = parseCsv(text);
  const tasks: ImportedTask[] = [];
  let phase: ImportedTask['phase'] = 'opening';
  let currentDate: string | null = null;
  let redactions = 0;
  for (const row of rows) {
    const joined = row.join(' ');
    if (/\b(?:closing|end of day)\b/i.test(joined)) phase = 'closing';
    else if (/\b(?:opening|start of day)\b/i.test(joined)) phase = 'opening';
    const rowDate = row.map(cell => parseDaybookDate(cell)).find(Boolean) ?? null;
    if (rowDate) currentDate = rowDate;
    const rawTitle = (row[1] ?? '').trim();
    if (!rawTitle || /^\d+(?:\.\d+)?$/.test(rawTitle) || /^(opening|closing|start of day|end of day|staff name|date|allocate|closing time|all done|store needs|retail)$/i.test(rawTitle)) continue;
    if (!currentDate || (!/^\d+/.test(row[0] ?? '') && !row[2]?.trim())) continue;
    const clean = sanitizeImportedText(rawTitle);
    redactions += clean.redactions;
    if (!clean.text || /^\[secure details removed\]$/i.test(clean.text)) continue;
    const staffInitials = initials(row[2] ?? '');
    tasks.push({ phase, title: clean.text, recurrence: 'daily', signoffs: staffInitials ? [{ date: currentDate, initials: staffInitials }] : [] });
  }
  return { tasks, redactions };
}

export function parseBranchDailyTasks(text: string): ImportedTask[] {
  const rows = parseCsv(text);
  const weekdays: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const tasks: ImportedTask[] = [];
  let weekday = 1;
  let currentDate: string | null = null;
  for (const row of rows) {
    const dayCell = row.slice(0, 2).map(cell => normalizedHeader(cell)).find(cell => Object.keys(weekdays).some(day => cell.includes(day)));
    const day = dayCell && Object.keys(weekdays).find(name => dayCell.includes(name));
    if (day) { weekday = weekdays[day]; currentDate = null; }
    const rowDate = parseDaybookDate(row[2] ?? '');
    if (rowDate) currentDate = rowDate;
    const rawTitle = (row[1] ?? '').trim();
    if (!rawTitle || Object.keys(weekdays).some(name => normalizedHeader(rawTitle).includes(name)) || /^(daily jobs|date|start of day|end of day)$/i.test(rawTitle)) continue;
    const clean = sanitizeImportedText(rawTitle).text;
    if (!clean) continue;
    const staffInitials = initials(row[3] ?? '');
    tasks.push({ phase: 'during_day', title: clean, recurrence: 'weekly', weekday, signoffs: currentDate && staffInitials ? [{ date: currentDate, initials: staffInitials }] : [] });
  }
  return tasks;
}

export function parseBranchCommunications(text: string, branch: string): { records: ImportedCommunication[]; skippedBefore2026: number; redactions: number } {
  const rows = parseCsv(text);
  let headerIndex = findHeader(rows, ['date', 'message']);
  if (headerIndex < 0) headerIndex = rows.findIndex(row => row.some(cell => /communication book|notices/i.test(cell)));
  if (headerIndex < 0) return { records: [], skippedBefore2026: 0, redactions: 0 };
  const header = rows[headerIndex];
  const messageIndex = Math.max(1, header.findIndex(cell => normalizedHeader(cell).includes('message') || /communication book|notices/i.test(cell)));
  const names = header.slice(messageIndex + 1).map(value => value.trim());
  const records: ImportedCommunication[] = [];
  let skippedBefore2026 = 0;
  let redactions = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const date = parseDaybookDate(row[0] ?? '');
    const message = (row[messageIndex] ?? '').trim();
    if (date && message) {
      if (!shouldImportNewtownCommunication(date)) { skippedBefore2026 += 1; continue; }
      const clean = sanitizeImportedText(message); redactions += clean.redactions;
      records.push({ date, message: clean.text, reads: row.slice(messageIndex + 1).map((value, index) => ({ name: names[index] || initials(value), initials: initials(value) })).filter(read => read.initials), importKey: branchKey(branch, 'comms', date, clean.text) });
    } else if (message && records.length) {
      const clean = sanitizeImportedText(message); redactions += clean.redactions;
      records[records.length - 1].message += `\n${clean.text}`;
    }
  }
  return { records, skippedBefore2026, redactions };
}

export function parseBranchCustomerRequests(text: string, branch: string): ImportedRecord[] {
  const rows = parseCsv(text);
  const headerIndex = findHeader(rows, ['date']);
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(normalizedHeader);
  const column = (...terms: string[]) => headers.findIndex(header => terms.some(term => header.includes(term)));
  const nameIndex = column('customer name', 'cust name');
  const phoneIndex = column('phone'); const emailIndex = column('email'); const itemIndex = column('item name', 'item');
  const skuIndex = column('sku'); const quantityIndex = column('qty'); const transferIndex = column('transfer id');
  const staffIndex = column('staff'); const outcomeIndex = column('called'); const notesIndex = column('comments', 'notes');
  return rows.slice(headerIndex + 1).flatMap(row => {
    const date = parseDaybookDate(row[0] ?? ''); const customer = (row[nameIndex] ?? '').trim();
    if (!date || !customer) return [];
    const item = (row[itemIndex] ?? '').trim(); const title = `${customer} - ${item || 'Customer request'}`.slice(0, 255);
    return [{ type: 'customer_request' as const, date, title, details: { customer_name: customer, contact_details: [row[phoneIndex], row[emailIndex]].filter(Boolean).join(' · '), item, sku: row[skuIndex], quantity: row[quantityIndex], transfer_id: row[transferIndex], notes: row[notesIndex], contact_outcome: row[outcomeIndex] }, staffInitials: initials(row[staffIndex] ?? '') || 'IMP', importKey: branchKey(branch, 'request', date, title) }];
  });
}

export function parseBranchDiscrepancies(text: string, branch: string): ImportedRecord[] {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex(row => row.some(cell => normalizedHeader(cell).includes('actual qty') || normalizedHeader(cell).includes('actual quantity'))
    && row.some(cell => normalizedHeader(cell).includes('cin7') || normalizedHeader(cell).includes('cin 7')));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map(normalizedHeader);
  const column = (...terms: string[]) => headers.findIndex(header => terms.some(term => header.includes(term)));
  const skuIndex = column('sku', 'item code'); const itemIndex = column('product name', 'item description', 'name');
  const systemIndex = column('cin 7 quantity', 'qty in cin7'); const physicalIndex = column('actual quantity', 'actual qty');
  const staffIndex = column('staff'); const noteIndex = column('note'); const fixedDateIndex = column('date fixed'); const fixedByIndex = column('fixed by');
  let inheritedDate: string | null = null;
  return rows.slice(headerIndex + 1).flatMap(row => {
    inheritedDate = parseDaybookDate(row[0] ?? '') || inheritedDate;
    const sku = (row[skuIndex] ?? '').trim(); const item = (row[itemIndex] ?? '').trim();
    if (!sku && !item) return [];
    const system = Number(row[systemIndex]); const physical = Number(row[physicalIndex]);
    if (!Number.isFinite(system) || !Number.isFinite(physical)) return [];
    const title = (item || sku).slice(0, 255);
    return [{ type: 'stock_discrepancy' as const, date: inheritedDate, title, details: { sku, item, system_quantity: system, physical_quantity: physical, variance: physical - system, notes: row[noteIndex], date_fixed: row[fixedDateIndex], fixed_by: row[fixedByIndex] }, staffInitials: initials(row[staffIndex] ?? '') || 'IMP', importKey: branchKey(branch, 'discrepancy', inheritedDate, sku, title) }];
  });
}

export function parseBranchStoreNeeds(text: string, branch: string): ImportedRecord[] {
  const rows = parseCsv(text);
  const headerIndex = findHeader(rows, ['date']);
  if (headerIndex < 0) return [];
  const header = rows[headerIndex].map(normalizedHeader);
  const dateIndexes = header.map((value, index) => value === 'date' ? index : -1).filter(index => index >= 0);
  const output: ImportedRecord[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const leftDate = parseDaybookDate(row[dateIndexes[0]] ?? '');
    const leftItem = (row[dateIndexes[0] + 1] ?? '').trim();
    if (leftDate && leftItem) output.push({ type: 'store_need', date: leftDate, title: leftItem.slice(0, 255), details: { item: leftItem, store_notes: row[dateIndexes[0] + 2], warehouse_notes: row[dateIndexes[0] + 3], request_kind: 'consumable' }, staffInitials: 'IMP', importKey: branchKey(branch, 'need', leftDate, leftItem) });
    const rightStart = dateIndexes[dateIndexes.length - 1]; const rightDate = parseDaybookDate(row[rightStart] ?? '');
    const sku = (row[rightStart + 1] ?? '').trim(); const item = (row[rightStart + 2] ?? '').trim();
    if (rightDate && (sku || item)) output.push({ type: 'store_need', date: rightDate, title: (item || sku).slice(0, 255), details: { sku, item, quantity: row[rightStart + 3], store_notes: row[rightStart + 4], warehouse_notes: row[rightStart + 5], request_kind: 'stock' }, staffInitials: 'IMP', importKey: branchKey(branch, 'need', rightDate, sku, item) });
  }
  return output;
}

export function parseBranchSafeReferences(text: string, branch: string): { references: ImportedReference[]; rejectedRows: number } {
  const references: ImportedReference[] = [];
  let rejectedRows = 0;
  for (const row of parseCsv(text)) {
    const joined = row.filter(Boolean).join(' · ');
    if (!joined) continue;
    if (SENSITIVE_ROW_PATTERN.test(joined)) { rejectedRows += 1; continue; }
    for (let index = 0; index < row.length; index += 4) {
      const group = row.slice(index, index + 4).map(value => value.trim()).filter(Boolean);
      if (group.length < 2) continue;
      const title = group[0].replace(/\s*-\s*$/, '').trim();
      const content = group.slice(1).join(' · ');
      if (!title || !content || /^(owners? & managers?|staff contact|mt stores|nsw|melbourne)$/i.test(title)) continue;
      references.push({ category: /security|police|management/i.test(title) ? 'Store contacts' : 'Contacts', title: title.slice(0, 255), content, importKey: branchKey(branch, 'reference', title, content) });
    }
  }
  return { references: [...new Map(references.map(item => [item.importKey, item])).values()], rejectedRows };
}

export function parseStorageMap(text: string, branch: string): ImportedGuide[] {
  const guides: ImportedGuide[] = [];
  let regions: { index: number; name: string }[] = [];
  for (const row of parseCsv(text)) {
    const headings = row.map((cell, index) => ({ index, name: cell.replace(/\s+/g, ' ').trim() })).filter(item => item.name && item.name === item.name.toUpperCase() && /[A-Z]{3}/.test(item.name));
    if (headings.length) { regions = headings; continue; }
    for (const [index, raw] of row.entries()) {
      const productName = raw.replace(/\s+/g, ' ').trim();
      if (!productName || /^(latest update|staff)\s*:/i.test(productName)) continue;
      const region = [...regions].reverse().find(item => item.index <= index)?.name ?? 'Store storage';
      guides.push({ sku: '', productName: productName.slice(0, 500), category: 'Storage map', shelf: region.slice(0, 255), status: 'active', importKey: branchKey(branch, 'storage', region, productName) });
    }
  }
  return [...new Map(guides.map(item => [item.importKey, item])).values()];
}