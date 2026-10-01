import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
