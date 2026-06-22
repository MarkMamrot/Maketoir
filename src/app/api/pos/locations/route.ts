import { NextResponse } from 'next/server';
import { imsQuery } from '@/services/IMSMySQLService';

// This endpoint is public — only returns location names for device setup dropdown.
export async function GET() {
  try {
    const rows = await imsQuery<{ id: number; name: string; code: string | null; is_active: number }>(
      'SELECT id, name, code, is_active FROM ims_locations WHERE is_active = 1 ORDER BY name',
    );
    return NextResponse.json({ locations: rows });
  } catch (err: any) {
    console.error('POS locations error:', err);
    return NextResponse.json({ locations: [] });
  }
}
