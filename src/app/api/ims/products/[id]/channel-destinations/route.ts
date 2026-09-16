import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { evaluateChannelProducts } from '@/lib/channels/channelProductAssignmentRepository';
import { createDefaultSalesChannelRegistry } from '@/lib/channels/defaultRegistry';
import { reportRuntimeIssue } from '@/lib/runtimeIssues';
import { imsQuery } from '@/services/IMSMySQLService';

type Context = { params: { id: string } };

export async function GET(_: Request, { params }: Context) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const businessId = String(session.businessId ?? '');
  const productId = String(params.id ?? '').trim();
  if (!productId) return NextResponse.json({ error: 'Product ID is required.' }, { status: 400 });

  try {
    const products = await imsQuery<{ product_id: string }>(
      'SELECT product_id FROM ims_products WHERE business_id = ? AND product_id = ? LIMIT 1',
      [businessId, productId],
    );
    if (!products[0]) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });

    const registry = createDefaultSalesChannelRegistry();
    const instances = await SalesChannelInstanceRepository.listForBusiness(businessId);
    const destinations = await Promise.all(instances.map(async instance => {
      const evaluation = await evaluateChannelProducts({
        businessId,
        channelInstanceId: instance.channelInstanceId,
        productId,
        limit: 1,
      });
      const product = evaluation.products[0];
      if (!product) throw new Error('The channel evaluator did not return the requested product.');
      return {
        channelInstanceId: instance.channelInstanceId,
        displayName: instance.displayName,
        provider: instance.provider,
        providerDisplayName: registry.get(instance.provider).displayName,
        runtimeStatus: instance.runtimeStatus,
        readinessStatus: instance.readinessStatus,
        ruleDecision: product.ruleDecision,
        effectiveDecision: product.effectiveDecision,
        matchedRuleName: product.matchedRuleName,
        overrideMode: product.overrideMode,
        providerState: product.providerState,
      };
    }));

    return NextResponse.json({ success: true, productId, destinations });
  } catch (error) {
    await reportRuntimeIssue({
      businessId,
      source: 'ims.products',
      operation: 'load_channel_destinations',
      title: 'Product channel destinations could not be loaded',
      error,
      context: { productId },
      reference: { type: 'ims_product', id: productId },
    }).catch(() => null);
    return NextResponse.json({ error: 'Product channel destinations could not be loaded.' }, { status: 500 });
  }
}