import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { BrandProfileRepository } from '@/lib/db/BrandProfileRepository';
import { ConfigRepository } from '@/lib/db/ConfigRepository';

function parsePhysicalBranches(raw: any) {
  if (!raw) return '';
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : raw;
    } catch {
      return raw;
    }
  }
  return raw;
}

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

    const row = await BrandProfileRepository.get(databaseId);
    if (!row) return NextResponse.json({});

    return NextResponse.json({
      mission:           row.mission            ?? '',
      uvp:               row.uvp                ?? '',
      tone:              row.tone               ?? '',
      demographics:      row.demographics       ?? '',
      geo:               row.geo                ?? '',
      products:          row.hero_products      ?? '',
      pricing:           row.price_positioning  ?? '',
      praises:           row.praises            ?? '',
      objections:        row.objections         ?? '',
      competitors:       row.competitors        ?? '',
      marketGap:         row.market_gap         ?? '',
      logoUrl:           row.logo_url           ?? '',
      brandColours:      row.brand_colours      ?? '',
      shippingPolicy:    row.shipping_policy    ?? '',
      connectedSoftware: row.connected_software ?? '',
      operationsSummary: row.operations_summary ?? '',
      returnsPolicy:     row.returns_policy     ?? '',
      brandHistory:      row.brand_history      ?? '',
      detailedBrandAesthetic: row.detailed_brand_aesthetic ?? '',
      physicalBranches:  parsePhysicalBranches(row.physical_branches ?? ''),
      loyaltyProgram:    row.loyalty_program    ?? '',
    });
  } catch (error: any) {
    console.error('Brand profile read error:', error);
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
    const {
      databaseId, mission, uvp, tone, demographics, geo, products, pricing,
      praises, objections, competitors, marketGap, logoUrl, brandColours,
      shippingPolicy, returnsPolicy, connectedSoftware, operationsSummary,
      brandHistory, detailedBrandAesthetic, physicalBranches, loyaltyProgram, logoBase64, logoMimeType,
    } = body;

    if (!databaseId) {
      return NextResponse.json({ error: 'Missing databaseId.' }, { status: 400 });
    }

    // Upload logo to Drive if provided
    let finalLogoUrl: string = logoUrl || '';
    let logoWarning: string | undefined;
    if (logoBase64 && typeof logoBase64 === 'string' && logoBase64.trim()) {
      try {
        const folderId = await ConfigRepository.get(databaseId, 'FolderID')
          ?? process.env.GOOGLE_USER_DB_FOLDER_ID ?? '';
        if (folderId) {
          const sheetsService = new GoogleSheetsService();
          const mime = logoMimeType || 'image/jpeg';
          const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
          finalLogoUrl = await sheetsService.uploadFileToDrive(logoBase64, mime, `logo.${ext}`, folderId);
        } else {
          logoWarning = 'Logo could not be saved to Drive — no folder ID found in Config. Profile text was saved.';
        }
      } catch (uploadErr: any) {
        logoWarning = `Logo upload failed: ${uploadErr.message}`;
      }
    }

    const coloursStr = typeof brandColours === 'object' && brandColours !== null
      ? JSON.stringify(brandColours)
      : (brandColours || '');

    const physStr = !physicalBranches ? null
      : typeof physicalBranches === 'string' ? physicalBranches
      : JSON.stringify(physicalBranches);

    await BrandProfileRepository.upsert(databaseId, {
      mission:            mission           || null,
      uvp:                uvp               || null,
      tone:               tone              || null,
      demographics:       demographics      || null,
      geo:                geo               || null,
      hero_products:      products          || null,
      price_positioning:  pricing           || null,
      praises:            praises           || null,
      objections:         objections        || null,
      competitors:        competitors       || null,
      market_gap:         marketGap         || null,
      logo_url:           finalLogoUrl      || null,
      brand_colours:      coloursStr        || null,
      shipping_policy:    shippingPolicy    || null,
      connected_software: connectedSoftware || null,
      operations_summary: operationsSummary || null,
      returns_policy:     returnsPolicy     || null,
      brand_history:      brandHistory      || null,
      detailed_brand_aesthetic: detailedBrandAesthetic || null,
      physical_branches:  physStr,
      loyalty_program:    loyaltyProgram    || null,
    });

    return NextResponse.json({
      success: true,
      message: 'Brand profile saved successfully.',
      logoUrl: finalLogoUrl,
      ...(logoWarning ? { logoWarning } : {}),
    });
  } catch (error: any) {
    console.error('Brand profile update error:', error);
    return NextResponse.json({ error: 'Failed to update user database' }, { status: 500 });
  }
}