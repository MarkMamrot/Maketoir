import { NextResponse } from 'next/server';
import { getImsSession } from '@/lib/auth/imsSession';
import { requireAdminSession } from '@/lib/sessionUtils';
import { imsQuery } from '@/services/IMSMySQLService';

export async function GET(req: Request) {
  const { user, response } = requireAdminSession();
  if (response) return response;
  await getImsSession();

  const query = new URL(req.url).searchParams.get('q')?.trim() || '';
  if (query.length < 2) return NextResponse.json({ contacts: [] });
  const like = `%${query.slice(0, 100)}%`;
  const contacts = await imsQuery<{
    id: number;
    name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string;
  }>(
    `SELECT id, name, first_name, last_name, email
       FROM ims_contacts
      WHERE business_id = ? AND email IS NOT NULL AND email <> ''
        AND is_active = 1 AND deleted_at IS NULL
        AND (name LIKE ? OR first_name LIKE ? OR last_name LIKE ?
          OR CONCAT(first_name, ' ', last_name) LIKE ? OR email LIKE ?)
      ORDER BY last_name, first_name, name
      LIMIT 10`,
    [user.businessId, like, like, like, like, like],
  );

  return NextResponse.json({
    contacts: contacts.map(contact => ({
      id: Number(contact.id),
      name: String(contact.name || `${contact.first_name || ''} ${contact.last_name || ''}`).trim(),
      email: String(contact.email).trim().toLowerCase(),
    })),
  });
}
