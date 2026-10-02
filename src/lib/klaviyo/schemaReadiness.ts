import { imsQuery } from '@/services/IMSMySQLService';

interface TableRow {
  table_name: string;
}

const REQUIRED_TABLES = ['ims_klaviyo_profile_mappings', 'ims_klaviyo_outbox'];

export async function isKlaviyoTenantSchemaReady(): Promise<boolean> {
  const rows = await imsQuery<TableRow>(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME IN (?, ?)`,
    REQUIRED_TABLES,
  );
  return new Set(rows.map(row => row.table_name)).size === REQUIRED_TABLES.length;
}