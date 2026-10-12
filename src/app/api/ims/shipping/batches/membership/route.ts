import { NextResponse } from "next/server";
import { getImsSession } from "@/lib/auth/imsSession";
import { runImsForBusiness } from "@/lib/db/BusinessRegistry";
import { changeShippingBatchMembership } from "@/lib/ims/shipping/shippingBatches";
import { ShippingBatchError, validateShippingBatchMembershipInput } from "@/lib/ims/shipping/shippingBatchTypes";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";

export async function PATCH(request: Request) {
  const session = await getImsSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (session.tier === "Advisor")
    return NextResponse.json({ error: "Advisor accounts are read-only." }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  try {
    validateShippingBatchMembershipInput(body);
    const input = body;
    const data = await runImsForBusiness(session.businessId,
      () => changeShippingBatchMembership(session.businessId, input));
    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ShippingBatchError)
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    await reportRuntimeIssue({
      businessId: session.businessId, source: "ims_shipping", operation: "change_batch_membership",
      title: "Shipping batch membership could not be changed",
      error: new Error("Shipping batch membership transaction failed."),
      context: { errorType: error instanceof Error ? error.name : "Unknown" },
      reference: { type: "shipping_batch", id: "membership" },
    });
    return NextResponse.json({ success: false, error: "Unable to change batch membership." }, { status: 500 });
  }
}
