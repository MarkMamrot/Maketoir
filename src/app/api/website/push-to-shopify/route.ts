import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleSheetsService } from '@/services/GoogleSheetsService';
import { ShopifyService } from '@/services/ShopifyService';
import { decrypt } from '@/lib/encryption';

export async function POST(req: Request) {
  try {
    const session = cookies().get('marketoir_session');
    if (!session?.value) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
    }

    const body = await req.json();
    const {
      databaseId,
      sku,
      title,
      websiteDescription,
      tags,
      images = [],
    }: {
      databaseId: string;
      sku: string;
      title: string;
      websiteDescription: string;
      tags: string;
      images: string[];
    } = body;

    if (!databaseId || !sku) {
      return NextResponse.json({ error: 'Missing databaseId or sku' }, { status: 400 });
    }

    const sheets = new GoogleSheetsService();

    // Load Shopify credentials
    const connRows = await sheets.getData(databaseId, 'Connections') as string[][];
    if (!connRows || connRows.length < 2) {
      return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });
    }
    const hdrs = connRows[0] as string[];
    const vals = connRows[1] as string[];
    const rawShopId = vals[hdrs.indexOf('ShopifyShopId')] || '';
    const encToken  = vals[hdrs.indexOf('ShopifyAccessToken')] || '';

    if (!rawShopId || !encToken) {
      return NextResponse.json({ error: 'Shopify credentials not configured.' }, { status: 400 });
    }

    const shopName = rawShopId.replace(/\.myshopify\.com$/, '');
    if (!/^[a-zA-Z0-9-]+$/.test(shopName)) {
      return NextResponse.json({ error: 'Invalid Shopify shop name.' }, { status: 400 });
    }
    const accessToken = decrypt(encToken);
    const shopifyAdminBase = `https://${shopName}.myshopify.com/admin/api/2024-01`;

    // Find the Shopify product by variant SKU using the GraphQL Admin API
    // (The REST GET /variants.json does not support sku filtering)
    const safeSku = sku.trim().replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const gqlRes = await fetch(
      `https://${shopName}.myshopify.com/admin/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: `{ productVariants(first: 5, query: "sku:'${safeSku}'") { edges { node { sku product { legacyResourceId } } } } }`,
        }),
      },
    );
    if (!gqlRes.ok) {
      const errText = await gqlRes.text();
      return NextResponse.json(
        { error: `Shopify GraphQL lookup failed (HTTP ${gqlRes.status}): ${errText.slice(0, 200)}` },
        { status: 400 },
      );
    }
    const gqlData = await gqlRes.json();
    if (gqlData.errors?.length) {
      return NextResponse.json(
        { error: `Shopify GraphQL error: ${gqlData.errors[0]?.message ?? 'Unknown'}` },
        { status: 400 },
      );
    }
    const edges: any[] = gqlData.data?.productVariants?.edges ?? [];
    const matchedEdge = edges.find((e: any) => e.node?.sku?.trim() === sku.trim());
    if (!matchedEdge) {
      return NextResponse.json(
        { error: `Variant SKU "${sku}" not found in Shopify. Ensure the product was uploaded with a matching variant SKU, then try again.` },
        { status: 404 },
      );
    }
    const shopifyProductId = String(matchedEdge.node.product.legacyResourceId);

    const shopify = new ShopifyService(shopName, accessToken);

    // Update product content
    const productUpdates: any = {};
    if (title?.trim())              productUpdates.title     = title.trim();
    if (websiteDescription?.trim()) productUpdates.body_html = websiteDescription.trim();
    if (tags?.trim())               productUpdates.tags      = tags.trim();

    if (Object.keys(productUpdates).length > 0) {
      await shopify.updateProduct(parseInt(shopifyProductId, 10), productUpdates);
    }

    // Normalise image URLs before upload: unescape \/ and collapse double slashes in paths
    const normaliseUrl = (u: string) =>
      u.replace(/\\\//g, '/').replace(/([^:])\/{2,}/g, '$1/');

    // Upload images via Shopify REST API (non-empty http URLs only)
    const validImages = images
      .map(u => normaliseUrl(u?.trim() ?? ''))
      .filter(u => u && u.startsWith('http'));
    const imageErrors: string[] = [];
    for (const imageUrl of validImages) {
      try {
        const imgRes = await fetch(
          `${shopifyAdminBase}/products/${shopifyProductId}/images.json`,
          {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': accessToken,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image: { src: imageUrl.trim() } }),
          },
        );
        if (!imgRes.ok) {
          const errText = await imgRes.text();
          imageErrors.push(`Image "${imageUrl.slice(0, 60)}" — HTTP ${imgRes.status}: ${errText.slice(0, 120)}`);
        }
      } catch (imgErr: any) {
        imageErrors.push(`Image "${imageUrl.slice(0, 60)}" — ${imgErr.message}`);
      }
    }

    const message = imageErrors.length > 0
      ? `Product updated. ${validImages.length - imageErrors.length}/${validImages.length} images uploaded. Errors: ${imageErrors.join('; ')}`
      : `Product updated successfully with ${validImages.length} image(s).`;

    return NextResponse.json({ success: true, message });
  } catch (e: any) {
    console.error('[push-to-shopify]', e);
    return NextResponse.json({ error: e.message ?? 'Internal server error' }, { status: 500 });
  }
}
