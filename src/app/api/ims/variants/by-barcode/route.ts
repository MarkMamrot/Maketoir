import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ImsVariantsRepo } from '@/lib/ims/ImsRepository';

function getSession() {
  const c = cookies().get('marketoir_session');
  if (!c?.value) return null;
  try {
    return JSON.parse(c.value);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!getSession()) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const barcode = searchParams.get('barcode');

    if (!barcode) {
      return NextResponse.json(
        { error: 'barcode query parameter is required' },
        { status: 400 }
      );
    }

    // Use existing repository method that searches by barcode or SKU
    const variant = await ImsVariantsRepo.findByBarcodeOrSku(barcode);

    if (!variant) {
      return NextResponse.json(
        { success: false, error: 'Variant not found', data: null },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        variant_id: variant.variant_id,
        product_id: variant.product_id,
        product_name: variant.product_name,
        sku: variant.sku,
        barcode: variant.barcode,
        option1_value: variant.option1_value,
        option2_value: variant.option2_value,
        option3_value: variant.option3_value,
        variant_label: variant.variant_label,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message },
      { status: 500 }
    );
  }
}
