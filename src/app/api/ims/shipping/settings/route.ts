import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import {
  validateCarrierAccountInput,
  validatePackagePresetInput,
  type CarrierAccountInput,
  type PackagePresetInput,
} from '@/lib/ims/shipping/shippingSettings';
import { ShippingSettingsRepository } from '@/lib/ims/shipping/shippingSettingsRepository';
import { getAusPostPackagingPresets } from '@/lib/ims/shipping/ausPostPackagingCatalogue';

export async function GET() {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const [accounts, presets] = await Promise.all([
      ShippingSettingsRepository.listAccounts(session.businessId),
      ShippingSettingsRepository.listPresets(session.businessId),
    ]);
    return NextResponse.json({ success: true, data: { accounts, presets } });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeMessage(error, 'Unable to load shipping settings.') }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return saveResource(request);
}

export async function PUT(request: Request) {
  return saveResource(request);
}

export async function DELETE(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'A valid record ID is required.' }, { status: 400 });
    if (body?.resource === 'account') await ShippingSettingsRepository.deactivateAccount(session.businessId, id);
    else if (body?.resource === 'preset') await ShippingSettingsRepository.deactivatePreset(session.businessId, id);
    else return NextResponse.json({ error: 'Choose a shipping settings resource.' }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeMessage(error, 'Unable to update shipping settings.') }, { status: 500 });
  }
}

async function saveResource(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (session.tier === 'Advisor') return NextResponse.json({ error: 'Advisor accounts are read-only.' }, { status: 403 });
  try {
    const body = await request.json();
    if (body?.resource === 'account') {
      const input = body.data as CarrierAccountInput;
      const credentialsStored = input?.id
        ? await ShippingSettingsRepository.hasStoredCredentials(session.businessId, Number(input.id))
        : false;
      const errors = validateCarrierAccountInput(input, credentialsStored);
      if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
      const id = await ShippingSettingsRepository.saveAccount(session.businessId, input);
      return NextResponse.json({ success: true, id });
    }
    if (body?.resource === 'preset') {
      const input = body.data as PackagePresetInput;
      const errors = validatePackagePresetInput(input);
      if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
      const id = await ShippingSettingsRepository.savePreset(session.businessId, input);
      return NextResponse.json({ success: true, id });
    }
    if (body?.resource === 'auspost_catalogue') {
      const requestedIds = Array.isArray(body.catalogueIds)
        ? body.catalogueIds.filter((id: unknown): id is string => typeof id === 'string')
        : [];
      const presets = getAusPostPackagingPresets(requestedIds);
      if (!presets.length || presets.length !== new Set(requestedIds).size) {
        return NextResponse.json({ error: 'Choose valid Australia Post package presets.' }, { status: 400 });
      }
      const created = await ShippingSettingsRepository.importAusPostPresets(session.businessId, presets);
      return NextResponse.json({ success: true, created, skipped: presets.length - created });
    }
    return NextResponse.json({ error: 'Choose a shipping settings resource.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ success: false, error: safeMessage(error, 'Unable to save shipping settings.') }, { status: 500 });
  }
}

function safeMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
