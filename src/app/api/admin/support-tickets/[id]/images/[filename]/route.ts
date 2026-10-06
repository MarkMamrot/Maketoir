import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { requireSuperAdminTier } from '@/lib/sessionUtils';
import { getSupportTicket } from '@/lib/supportTickets';
import { supportImagePath, SupportTicketValidationError } from '@/lib/supportTicketImages';
import { detectOnlineShopAssetType } from '@/lib/onlineShop/onlineShopAssetStorage';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';

export async function GET(_request: Request, { params }: { params: { id: string; filename: string } }) {
  const auth = requireSuperAdminTier();
  if (auth.response) return auth.response;
  const id = Number(params.id);
  try {
    const filename = supportImagePath(id, params.filename);
    const ticket = await getSupportTicket(id);
    if (!ticket) return NextResponse.json({ error: 'Ticket not found.' }, { status: 404 });
    const bytes = await readFile(filename);
    const detected = detectOnlineShopAssetType(bytes);
    if (!detected) return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), { headers: {
      'Content-Type': detected.mimeType,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    if (error instanceof SupportTicketValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return NextResponse.json({ error: 'Image not found.' }, { status: 404 });
    await reportRuntimeIssue({ source: 'support-tickets', operation: 'read_image', title: 'Support ticket image could not be read', error, reference: { type: 'support_ticket', id } });
    return NextResponse.json({ error: 'Image could not be loaded.' }, { status: 500 });
  }
}