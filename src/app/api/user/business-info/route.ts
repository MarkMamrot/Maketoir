import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BusinessInfoRepository } from '@/lib/db/BusinessInfoRepository';

export async function GET(req: Request) {
  try {
    const sessionCookie = cookies().get('marketoir_session');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const databaseId = searchParams.get('databaseId');
    if (!databaseId) {
      return NextResponse.json({ error: 'Missing databaseId.' }, { status: 400 });
    }

    const row = await BusinessInfoRepository.get(databaseId);
    if (!row) return NextResponse.json({});

    return NextResponse.json({
      brandName:       row.brand_name        ?? '',
      brandUrl:        row.brand_url         ?? '',
      yearsInBusiness: row.years_in_business ?? '',
      facebookUrl:     row.facebook_link     ?? '',
      instagramUrl:    row.instagram_link    ?? '',
      pinterestUrl:    row.pinterest_link    ?? '',
      abn:             row.abn               ?? '',
    });
  } catch (error: any) {
    console.error('Business info read error:', error);
    return NextResponse.json({ error: 'Failed to read database' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const sessionCookie = cookies().get('marketoir_session');
    if (!sessionCookie?.value) {
      return NextResponse.json({ error: 'Unauthorized. Please log in.' }, { status: 401 });
    }

    const body = await req.json();
    const { databaseId, brandName, brandUrl, yearsInBusiness, facebookUrl, instagramUrl, pinterestUrl, abn } = body;

    const _u = JSON.parse(sessionCookie.value);
    if (!databaseId || databaseId !== _u.businessId) {
      return NextResponse.json({ error: 'Not authorised.' }, { status: 403 });
    }
    if (!brandName || !brandUrl || !yearsInBusiness) {
      return NextResponse.json({ error: 'Missing requested fields.' }, { status: 400 });
    }

    await BusinessInfoRepository.upsert(databaseId, {
      brand_name:        brandName,
      brand_url:         brandUrl,
      years_in_business: yearsInBusiness,
      facebook_link:     facebookUrl  || null,
      instagram_link:    instagramUrl || null,
      pinterest_link:    pinterestUrl || null,
      abn:               abn || null,
    });

    return NextResponse.json({ success: true, message: 'Business information saved to database successfully.' });
  } catch (error: any) {
    console.error('Business info update error:', error);
    return NextResponse.json({ error: 'Failed to update user database' }, { status: 500 });
  }
}
