import { NextResponse } from 'next/server';

import { getImsSession } from '@/lib/auth/imsSession';
import { SalesChannelInstanceRepository } from '@/lib/channels/channelInstanceRepository';
import { evaluateChannelProducts } from '@/lib/channels/channelProductAssignmentRepository';
import { getChannelProductLinks } from '@/lib/channels/channelProductLinks';
import { createDefaultSalesChannelRegistry } from '@/lib/channels/defaultRegistry';
import { channelProductAssignmentMode } from '@/lib/channels/types';
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
        assignmentMode: channelProductAssignmentMode(instance.settings),
      });
      const product = evaluation.products[0];
      if (!product) throw new Error('The channel evaluator did not return the requested product.');
      const links = product.desiredState === 'published'
        ? await getChannelProductLinks({ businessId, productId, instance }).catch(() => ({ storefrontUrl: null, adminUrl: null }))
        : { storefrontUrl: null, adminUrl: null };
      return {
        channelInstanceId: instance.channelInstanceId,
        displayName: instance.displayName,
        provider: instance.provider,
        providerDisplayName: registry.get(instance.provider).displayName,
        enabled: instance.enabled,
        runtimeStatus: instance.runtimeStatus,
        readinessStatus: instance.readinessStatus,
        safeError: instance.safeError,
        assignmentMode: channelProductAssignmentMode(instance.settings),
        ruleDecision: product.ruleDecision,
        effectiveDecision: product.effectiveDecision,
        matchedRuleName: product.matchedRuleName,
        overrideMode: product.overrideMode,
        desiredState: product.desiredState,
        providerState: product.providerState,
        ...links,
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