import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getCin7Credentials, resolveInventorySystemId, cin7FetchAllPages } from '@/lib/cin7Helpers';
import { BranchesRepository } from '@/lib/db/BranchesAndSuppliersRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

function parseBranch(branch: any): { name: string; isActive: boolean } {
  const fullName = [branch.firstName ?? branch.FirstName ?? '', branch.lastName ?? branch.LastName ?? '']
    .map((v: any) => String(v).trim()).filter(Boolean).join(' ');
  const name = String(
    branch.name ?? branch.Name ?? branch.company ?? branch.Company
    ?? branch.branchName ?? branch.BranchName ?? fullName ?? ''
  );
  const val = branch.isActive ?? branch.IsActive ?? branch.active ?? branch.Active;
  const isActive = val == null ? true
    : typeof val === 'boolean' ? val
    : typeof val === 'number' ? val !== 0
    : String(val).toLowerCase() !== 'false' && String(val) !== '0';
  return { name, isActive };
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ success: false, error: 'Not authenticated.' }, { status: 401 });

  const { databaseId, activeBranchesOnly = true } = await req.json();
  if (!databaseId) return NextResponse.json({ success: false, error: 'databaseId is required.' }, { status: 400 });
  const _u = JSON.parse(session.value);
  if (databaseId !== _u.businessId) {
    return NextResponse.json({ success: false, error: 'Not authorised.' }, { status: 403 });
  }

  let creds;
  try { creds = await getCin7Credentials(databaseId); }
  catch (e: any) { return NextResponse.json({ success: false, error: e.message }, { status: 400 }); }

  const inventorySystemId = await resolveInventorySystemId(databaseId);
  const syncedAt = new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 19);

  let rawBranches: any[];
  try {
    rawBranches = await cin7FetchAllPages(creds.authHeader, '/Branches', {}, 'cin7/branches');
    console.log(`[cin7/branches] Raw fetch returned ${rawBranches.length} records`);
  } catch (e: any) {
    return NextResponse.json({ success: false, error: `Failed to fetch branches: ${e.message}` }, { status: 502 });
  }

  let branches = rawBranches;
  if (activeBranchesOnly && branches.length > 0) {
    const active = branches.filter(b => parseBranch(b).isActive);
    branches = active.length > 0 ? active : branches;
  }
  console.log(`[cin7/branches] After filter: ${branches.length} branch records`);

  const rows = branches
    .map(b => ({ cin7_id: String(b.id ?? b.ID ?? b.branchId ?? ''), ...parseBranch(b) }))
    .filter(r => r.name);

  await BranchesRepository.bulkReplace(
    inventorySystemId,
    rows.map(r => ({
      cin7_id:        r.cin7_id,
      name:           r.name,
      is_active:      r.isActive,
      last_synced_at: syncedAt,
    })),
  );

  await ConfigRepository.set(databaseId, 'LastBranchesSync', syncedAt);

  return NextResponse.json({
    success: true,
    synced: rows.length,
    message: `Synced ${rows.length} branch${rows.length !== 1 ? 'es' : ''} to database.`,
  });
}
