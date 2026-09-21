import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { getShippingStockReadiness } from "@/lib/ims/shipping/shippingStockReadiness";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";

export async function POST(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const body = await request.json();
    const shipmentIds = Array.isArray(body?.shipmentIds) ? body.shipmentIds.map(Number) : [];
    const data = await getShippingStockReadiness({ businessId: session.businessId, shipmentIds });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check shipment stock.";
    const validation = /choose|not found/i.test(message);
    if (!validation) {
      await reportRuntimeIssue({
        businessId: session.businessId,
        source: "ims_shipping",
        operation: "check_stock_readiness",
        title: "Shipping stock readiness check failed",
        error,
      });
    }
    return NextResponse.json({ success: false, error: message }, { status: validation ? 400 : 500 });
  }
}