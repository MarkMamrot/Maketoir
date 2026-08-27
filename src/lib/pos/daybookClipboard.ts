export type DaybookClipboardRecord = {
  id: number;
  recordType: 'customer_request' | 'store_need';
  title: string;
  details: Record<string, unknown>;
};

export type DaybookClipboardItem = {
  id: number;
  recordType: 'customer_request' | 'store_need';
  text: string;
};

const LABELS: Record<string, string> = {
  customer_name: 'Customer',
  contact_details: 'Contact',
  item: 'Item',
  notes: 'Notes',
  quantity: 'Quantity',
  unit: 'Unit',
  store_notes: 'Store notes',
};

export function formatDaybookClipboardRecord(record: DaybookClipboardRecord): DaybookClipboardItem {
  const heading = record.recordType === 'store_need' ? 'Store need' : 'Customer request';
  const detailLines = Object.entries(record.details)
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `${LABELS[key] ?? key.replaceAll('_', ' ')}: ${String(value)}`);
  return {
    id: record.id,
    recordType: record.recordType,
    text: [`${heading}: ${record.title}`, ...detailLines].join('\n'),
  };
}

export function addDaybookClipboardItem(items: DaybookClipboardItem[], item: DaybookClipboardItem): DaybookClipboardItem[] {
  return [...items.filter(existing => !(existing.id === item.id && existing.recordType === item.recordType)), item];
}

export function serializeDaybookClipboard(items: DaybookClipboardItem[]): string {
  return items.map(item => item.text.trim()).join('\n\n--------------------\n\n');
}
