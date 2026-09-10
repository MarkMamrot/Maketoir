import { NextResponse } from "next/server";

import { getImsSession } from "@/lib/auth/imsSession";
import { getShippingManifestLabelsPdf } from "@/lib/ims/shipping/shippingManifests";
import { reportRuntimeIssue } from "@/lib/runtimeIssues";

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getImsSession();
  if (!session)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const manifestId = Number(params.id);
  if (!Number.isInteger(manifestId) || manifestId <= 0)
    return NextResponse.json(
      { error: "A valid manifest ID is required." },
      { status: 400 },
    );
  try {
    const layout = new URL(request.url).searchParams.get("layout") ?? "";
    const result = await getShippingManifestLabelsPdf(
      session.businessId,
      manifestId,
      layout,
    );
    return new NextResponse(result.bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${result.filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to download manifest labels.";
    await reportRuntimeIssue({
      businessId: session.businessId,
      source: "ims_shipping",
      operation: "download_manifest_labels",
      title: "Manifest labels could not be downloaded",
      error,
      context: {
        manifestId,
        layout: new URL(request.url).searchParams.get("layout"),
      },
      reference: { type: "shipping_manifest", id: String(manifestId) },
    });
    return NextResponse.json(
      { success: false, error: message },
      { status: 502 },
    );
  }
}
