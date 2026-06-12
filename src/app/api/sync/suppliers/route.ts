import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCin7Credentials, resolveInventorySystemId, cin7FetchAllPages } from '@/lib/cin7Helpers';
import { SuppliersRepository } from '@/lib/db/BranchesAndSuppliersRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/sync/suppliers
 * Body: { databaseId: string }
 */
export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });

  let creds;
  try { creds = await getCin7Credentials(databaseId); }
  catch (e: any) { return NextResponse.json({ success: false, error: e.message }, { status: 400 }); }

  const inventorySystemId = await resolveInventorySystemId(databaseId);
  const syncedAt = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

  let contacts: any[];
  try {
    const all = await cin7FetchAllPages(creds.authHeader, '/Contacts', {}, 'cin7/suppliers');
    contacts = all.filter(c => {
      const t = (c.type ?? '').toLowerCase();
      return t === 'supplier' || t === 'supplier/customer';
    });
    console.log(`[cin7/suppliers] ${contacts.length} suppliers from ${all.length} total contacts`);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to fetch contacts: ${e.message}` }, { status: 502 });
  }

  await SuppliersRepository.bulkReplace(
    inventorySystemId,
    contacts.map(c => ({
      cin7_id:        String(c.id ?? ''),
      name:           c.company || [c.firstName, c.lastName].filter(Boolean).join(' ') || String(c.id),
      contact_name:   [c.firstName, c.lastName].filter(Boolean).join(' ') || null,
      email:          c.email ?? null,
      phone:          c.phone ?? null,
      country:        c.country ?? null,
      lead_time_days: null,
      last_synced_at: syncedAt,
    })),
  );

  await ConfigRepository.set(databaseId, 'LastSuppliersSync', syncedAt);

  return NextResponse.json({
    success: true,
    synced: contacts.length,
    message: `Synced ${contacts.length} supplier${contacts.length !== 1 ? 's' : ''} to database.`,
  });
}
