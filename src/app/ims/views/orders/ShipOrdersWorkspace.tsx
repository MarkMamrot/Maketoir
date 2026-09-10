"use client";

import {
  ClipboardList,
  Download,
  PackageCheck,
  Plus,
  Printer,
  RefreshCw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  suggestParcels,
  type PackableUnit,
  type PackingPreset,
} from "@/lib/ims/shipping/packingSuggestions";
import {
  canDeleteShippingDraft,
  getShippingOrderEligibility,
  isAustralianShippingCountry,
} from "@/lib/ims/shipping/shippingWorkflow";
import {
  buildNonSaleDeclaredValueInputs,
  buildWorkspaceCustomsRows,
  getWorkspaceCustomsBlockers,
  type WorkspaceCustomsLine,
} from "@/lib/ims/shipping/workspaceCustoms";
import type { ShippingExportPurpose } from "@/lib/ims/shipping/customs";

type SalesOrderSummary = {
  id: number;
  so_number: string;
  channel_order_number?: string | null;
  external_order_number?: string | null;
  shopify_order_name?: string | null;
  native_checkout_id?: string | null;
  channel_shipping_method?: string | null;
  channel_delivery_type?: string | null;
  customer_name?: string | null;
  status: string;
  so_type?: string | null;
  is_pos_ledger?: boolean;
  remaining_quantity?: number;
  delivery_country?: string | null;
};

type SalesOrderDetail = SalesOrderSummary & {
  delivery_address?: string | null;
  delivery_suburb?: string | null;
  delivery_state?: string | null;
  delivery_postcode?: string | null;
  customer_email?: string | null;
  customer_phone?: string | null;
  tax_treatment?: "ex_tax" | "inc_tax" | "no_tax";
  items?: Array<{
    id: number;
    sku?: string | null;
    product_name?: string | null;
    product_id?: string | null;
    customs_description?: string | null;
    hs_code?: string | null;
    country_of_origin?: string | null;
    is_dangerous_or_restricted?: number;
    qty_ordered: number;
    qty_fulfilled: number;
    unit_price: number;
    discount_pct: number;
    tax_rate: number;
    weight_kg?: number | null;
    length_mm?: number | null;
    width_mm?: number | null;
    height_mm?: number | null;
  }>;
};

type CarrierAccount = {
  id: number;
  displayName: string;
  provider: string;
  verifiedAt: string | null;
  isActive: boolean;
  dispatchLocationName: string | null;
  dispatchAddressMissingFields: string[];
};
type ParcelAllocation = { soItemId: number; quantity: number };
type EditableParcel = {
  packagePresetId: string;
  packageType: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  weightKg: string;
  allocations: ParcelAllocation[];
};
type ShippingRate = {
  serviceCode: string;
  serviceName: string;
  total: number;
  totalExGst: number;
  gst: number;
};
type ShippingSubmissionResult = {
  shipmentId: number;
  soId: number;
  status: "label_pending" | "label_ready";
  providerShipmentId: string;
  labelUrl: string | null;
  chargedCost: number | null;
};
type SavedShippingShipment = {
  batchId: string;
  shipmentId: number;
  soId: number;
  soNumber: string;
  channelOrderNumber: string | null;
  customerName: string | null;
  status: string;
  serviceCode: string | null;
  serviceName: string | null;
  quotedCost: number | null;
  chargedCost: number | null;
  providerShipmentId: string | null;
  isInternational: boolean;
  destinationCountry: string | null;
  labelStatus: string | null;
  labelUrl: string | null;
};

type ManifestCandidateRow = {
  shipmentId: number;
  carrierAccountId: number;
  dispatchLocationId: number | null;
  provider: string;
  soNumber: string;
  channelOrderNumber: string | null;
  carrierName: string;
  dispatchLocationName: string | null;
  chargedCost: number | null;
  parcelCount: number;
};
type ManifestSummaryRow = {
  id: number;
  provider: string;
  providerReference: string;
  providerOrderId: string | null;
  status: string;
  carrierAccountId: number;
  carrierName: string;
  dispatchLocationId: number | null;
  dispatchLocationName: string | null;
  shipmentCount: number;
  parcelCount: number;
  safeError: string | null;
  createdAt: string;
  completedAt: string | null;
  orders: Array<{
    shipmentId: number;
    soNumber: string;
    channelOrderNumber: string | null;
  }>;
  labelLayouts: string[];
};

export function ShipOrdersWorkspace({
  orders,
  onClose,
}: {
  orders: SalesOrderSummary[];
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"shipments" | "manifests">(
    "shipments",
  );
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  const selectedOrderKey = orders
    .map((order) => Number(order.id))
    .sort((left, right) => left - right)
    .join(",");
  const [details, setDetails] = useState<SalesOrderDetail[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<CarrierAccount[]>([]);
  const [presets, setPresets] = useState<PackingPreset[]>([]);
  const [carrierAccountId, setCarrierAccountId] = useState("");
  const [parcelsByOrder, setParcelsByOrder] = useState<
    Record<number, EditableParcel[]>
  >({});
  const [quotesByOrder, setQuotesByOrder] = useState<
    Record<number, ShippingRate[]>
  >({});
  const [selectedServiceByOrder, setSelectedServiceByOrder] = useState<
    Record<number, ShippingRate>
  >({});
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [created, setCreated] = useState<
    Array<{ soId: number; shipmentId: number }>
  >([]);
  const [submissionResults, setSubmissionResults] = useState<
    ShippingSubmissionResult[]
  >([]);
  const [savedShipments, setSavedShipments] = useState<SavedShippingShipment[]>(
    [],
  );
  const [readyOrders, setReadyOrders] = useState<SalesOrderSummary[]>([]);
  const [readySelection, setReadySelection] = useState<Set<number>>(new Set());
  const [addingOrders, setAddingOrders] = useState(false);
  const [exportPurposeByOrder, setExportPurposeByOrder] = useState<
    Record<number, ShippingExportPurpose>
  >({});
  const [nonSaleValuesByOrder, setNonSaleValuesByOrder] = useState<
    Record<number, Record<number, string>>
  >({});
  const [confirmedNonSaleOrders, setConfirmedNonSaleOrders] = useState<
    Set<number>
  >(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    const selectedOrders = ordersRef.current;
    Promise.all([
      Promise.all(
        selectedOrders.map(async (order) => {
          const response = await fetch(`/api/ims/sales-orders/${order.id}`);
          const result = await response.json();
          if (!response.ok || !result.success)
            throw new Error(
              result.error || `Unable to load ${order.so_number}.`,
            );
          return result.data as SalesOrderDetail;
        }),
      ),
      fetch("/api/ims/shipping/settings").then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(result.error || "Unable to load shipping settings.");
        return result.data as {
          accounts: CarrierAccount[];
          presets: PackingPreset[];
        };
      }),
      fetch("/api/ims/shipping/drafts").then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(result.error || "Unable to load saved shipments.");
        return result.data as SavedShippingShipment[];
      }),
      fetch("/api/ims/shipping/orders").then(async (response) => {
        const result = await response.json();
        if (!response.ok || !result.success)
          throw new Error(
            result.error || "Unable to load orders ready to ship.",
          );
        return result.data as SalesOrderSummary[];
      }),
    ])
      .then(([orderDetails, settings, activeShipments, availableOrders]) => {
        if (!active) return;
        setDetails(orderDetails);
        const activeAccounts = settings.accounts.filter(
          (account) =>
            account.isActive && account.provider === "auspost_eparcel",
        );
        const activePresets = settings.presets.filter(
          (preset: PackingPreset & { isActive?: boolean }) =>
            preset.isActive !== false,
        );
        setAccounts(activeAccounts);
        setPresets(activePresets);
        setCarrierAccountId(
          activeAccounts[0] ? String(activeAccounts[0].id) : "",
        );
        setParcelsByOrder(
          Object.fromEntries(
            orderDetails.map((order) => [
              order.id,
              initialParcels(order, activePresets),
            ]),
          ),
        );
        setSavedShipments(activeShipments);
        setReadyOrders(availableOrders);
      })
      .catch((reason) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Unable to prepare these orders.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedOrderKey]);

  const savedOrderIds = new Set(
    savedShipments.map((shipment) => shipment.soId),
  );
  const plans = details
    .filter((order) => !savedOrderIds.has(order.id))
    .map((order) => ({ order, ...buildPackingPlan(order, presets) }));
  const selectedAccount = accounts.find(
    (account) => String(account.id) === carrierAccountId,
  );
  const dispatchAddressReady = Boolean(
    selectedAccount &&
    selectedAccount.dispatchAddressMissingFields.length === 0,
  );
  const canCreate =
    dispatchAddressReady &&
    plans.length > 0 &&
    plans.every(
      (plan) =>
        plan.ready &&
        validEditableParcels(plan.order, parcelsByOrder[plan.order.id]) &&
        customsBlockersForOrder(
          plan.order,
          parcelsByOrder[plan.order.id] ?? [],
          exportPurposeByOrder[plan.order.id] ?? "sale",
          nonSaleValuesByOrder[plan.order.id] ?? {},
          confirmedNonSaleOrders.has(plan.order.id),
        ).length === 0,
    );
  const shipments = plans.map((plan) => {
    const purpose = exportPurposeByOrder[plan.order.id] ?? "sale";
    const orderParcels = parcelsByOrder[plan.order.id] ?? [];
    const customsRows = customsRowsForOrder(
      plan.order,
      orderParcels,
      purpose,
      nonSaleValuesByOrder[plan.order.id] ?? {},
    );
    return {
      soId: plan.order.id,
      ...(isInternationalOrder(plan.order) ? {
        exportPurpose: purpose,
        nonSaleValues: purpose === "sale"
          ? undefined
          : buildNonSaleDeclaredValueInputs(customsRows),
        nonSaleValuesConfirmed: purpose === "sale"
          ? undefined
          : confirmedNonSaleOrders.has(plan.order.id),
      } : {}),
      parcels: orderParcels.map((parcel, index) => ({
        parcelNumber: index + 1,
        packagePresetId: parcel.packagePresetId
          ? Number(parcel.packagePresetId)
          : null,
        packageType: parcel.packageType || "custom",
        lengthMm: Number(parcel.lengthMm),
        widthMm: Number(parcel.widthMm),
        heightMm: Number(parcel.heightMm),
        weightKg: Number(parcel.weightKg),
        allocations: parcel.allocations.filter(
          (allocation) => allocation.quantity > 0,
        ),
      })),
    };
  });

  const changeExportPurpose = (
    order: SalesOrderDetail,
    purpose: ShippingExportPurpose,
  ) => {
    setExportPurposeByOrder((current) => ({ ...current, [order.id]: purpose }));
    setConfirmedNonSaleOrders((current) => {
      const next = new Set(current);
      next.delete(order.id);
      return next;
    });
    if (purpose !== "sale") {
      const saleRows = customsRowsForOrder(
        order,
        parcelsByOrder[order.id] ?? [],
        "sale",
        {},
      );
      setNonSaleValuesByOrder((current) => ({
        ...current,
        [order.id]: Object.fromEntries(
          saleRows.map((row) => [
            row.id,
            current[order.id]?.[row.id] ??
              (row.unitValue == null ? "" : row.unitValue.toFixed(2)),
          ]),
        ),
      }));
    }
    setError("");
    setQuotesByOrder({});
    setSelectedServiceByOrder({});
  };

  const updateParcel = (
    soId: number,
    parcelIndex: number,
    patch: Partial<EditableParcel>,
  ) => {
    setParcelsByOrder((current) => ({
      ...current,
      [soId]: (current[soId] ?? []).map((parcel, index) =>
        index === parcelIndex ? { ...parcel, ...patch } : parcel,
      ),
    }));
    setError("");
    setQuotesByOrder({});
    setSelectedServiceByOrder({});
  };

  const choosePreset = (
    soId: number,
    parcelIndex: number,
    presetId: string,
  ) => {
    const preset = presets.find((item) => item.id === Number(presetId));
    updateParcel(
      soId,
      parcelIndex,
      preset
        ? {
            packagePresetId: presetId,
            packageType: preset.packageType,
            lengthMm: String(preset.lengthMm),
            widthMm: String(preset.widthMm),
            heightMm: String(preset.heightMm),
          }
        : { packagePresetId: "", packageType: "custom" },
    );
  };

  const updateAllocation = (
    soId: number,
    parcelIndex: number,
    soItemId: number,
    quantity: string,
  ) => {
    const value = quantity === "" ? 0 : Number(quantity);
    const parcel = parcelsByOrder[soId]?.[parcelIndex];
    if (!parcel) return;
    updateParcel(soId, parcelIndex, {
      allocations: parcel.allocations.map((allocation) =>
        allocation.soItemId === soItemId
          ? { ...allocation, quantity: value }
          : allocation,
      ),
    });
  };

  const addParcel = (order: SalesOrderDetail) => {
    setParcelsByOrder((current) => ({
      ...current,
      [order.id]: [
        ...(current[order.id] ?? []),
        {
          packagePresetId: "",
          packageType: "custom",
          lengthMm: "",
          widthMm: "",
          heightMm: "",
          weightKg: "",
          allocations: remainingAllocations(order, 0),
        },
      ],
    }));
    setError("");
    setQuotesByOrder({});
    setSelectedServiceByOrder({});
  };

  const removeParcel = (soId: number, parcelIndex: number) => {
    setParcelsByOrder((current) => ({
      ...current,
      [soId]: (current[soId] ?? []).filter((_, index) => index !== parcelIndex),
    }));
    setError("");
    setQuotesByOrder({});
    setSelectedServiceByOrder({});
  };

  const getQuotes = async () => {
    setQuoting(true);
    setError("");
    setQuotesByOrder({});
    try {
      const response = await fetch("/api/ims/shipping/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          carrierAccountId: Number(carrierAccountId),
          shipments,
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to retrieve shipping prices.");
      const quotes = Object.fromEntries(
        (result.data ?? []).map(
          (quote: { soId: number; rates: ShippingRate[] }) => [
            quote.soId,
            quote.rates,
          ],
        ),
      );
      setQuotesByOrder(quotes);
      setSelectedServiceByOrder({});
      if (
        (result.data ?? []).some(
          (quote: { rates: ShippingRate[] }) => quote.rates.length === 0,
        )
      ) {
        setError(
          "Australia Post did not return a common service for every parcel on one or more orders.",
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to retrieve shipping prices.",
      );
    } finally {
      setQuoting(false);
    }
  };

  const createDrafts = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/ims/shipping/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: crypto.randomUUID(),
          carrierAccountId: Number(carrierAccountId),
          shipments: shipments.map((shipment) => ({
            ...shipment,
            service: selectedServiceByOrder[shipment.soId],
          })),
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to prepare shipments.");
      setCreated(result.data ?? []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to prepare shipments.",
      );
    } finally {
      setSaving(false);
    }
  };

  const submitToCarrier = async () => {
    if (
      !labelsPending &&
      !window.confirm(
        "Submit these shipments to Australia Post and create billable postage labels?",
      )
    )
      return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/ims/shipping/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentIds: created.map((item) => item.shipmentId),
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(
          result.error || "Unable to submit shipments to Australia Post.",
        );
      setSubmissionResults(result.data ?? []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to submit shipments to Australia Post.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const hasSelectedServices =
    plans.length > 0 &&
    plans.every((plan) => Boolean(selectedServiceByOrder[plan.order.id]));
  const labelsPending = submissionResults.some(
    (result) => result.status === "label_pending",
  );
  const needsCarrierAction =
    submissionResults.length < created.length || labelsPending;
  const visibleSavedShipments = savedShipments;
  const savedBatches = groupSavedShipments(visibleSavedShipments);
  const availableReadyOrders = readyOrders.filter(
    (order) =>
      !details.some((detail) => Number(detail.id) === Number(order.id)) &&
      !savedShipments.some((shipment) => shipment.soId === Number(order.id)),
  );
  const openSavedShipments = (selected: SavedShippingShipment[]) => {
    setCreated(
      selected.map((shipment) => ({
        soId: shipment.soId,
        shipmentId: shipment.shipmentId,
      })),
    );
    setSubmissionResults(
      selected
        .filter((shipment) => shipment.providerShipmentId)
        .map((shipment) => ({
          shipmentId: shipment.shipmentId,
          soId: shipment.soId,
          status:
            shipment.labelStatus === "available"
              ? "label_ready"
              : "label_pending",
          providerShipmentId: shipment.providerShipmentId!,
          labelUrl: shipment.labelUrl,
          chargedCost: shipment.chargedCost,
        })),
    );
    setError("");
  };
  const deleteSavedShipments = async (selected: SavedShippingShipment[]) => {
    if (
      !selected.length ||
      selected.some(
        (shipment) =>
          !canDeleteShippingDraft(shipment.status, shipment.providerShipmentId),
      )
    )
      return;
    if (
      !window.confirm(
        `Delete ${selected.length} selected shipment draft${selected.length === 1 ? "" : "s"}? The orders will become available to prepare again.`,
      )
    )
      return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/ims/shipping/drafts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentIds: selected.map((shipment) => shipment.shipmentId),
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to delete shipment drafts.");
      const deleted = new Set<number>(result.data?.deletedShipmentIds ?? []);
      setSavedShipments((current) =>
        current.filter((shipment) => !deleted.has(shipment.shipmentId)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete shipment drafts.",
      );
    } finally {
      setDeleting(false);
    }
  };
  const addReadyOrders = async () => {
    const selected = availableReadyOrders.filter((order) =>
      readySelection.has(Number(order.id)),
    );
    if (!selected.length) return;
    setAddingOrders(true);
    setError("");
    try {
      const added = await Promise.all(
        selected.map(async (order) => {
          const response = await fetch(`/api/ims/sales-orders/${order.id}`);
          const result = await readJsonResponse(response);
          if (!response.ok || !result.success)
            throw new Error(
              result.error || `Unable to load ${order.so_number}.`,
            );
          return result.data as SalesOrderDetail;
        }),
      );
      setDetails((current) => [
        ...current,
        ...added.filter(
          (order) =>
            !current.some((item) => Number(item.id) === Number(order.id)),
        ),
      ]);
      setParcelsByOrder((current) => ({
        ...current,
        ...Object.fromEntries(
          added.map((order) => [order.id, initialParcels(order, presets)]),
        ),
      }));
      setReadySelection(new Set());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to add orders to this shipment batch.",
      );
    } finally {
      setAddingOrders(false);
    }
  };
  const markDispatched = async () => {
    if (
      !window.confirm(
        "Mark these labelled shipments as dispatched? This updates stock and Sales Order fulfillment, then syncs the connected channel.",
      )
    )
      return;
    setDispatching(true);
    setError("");
    setDispatchMessage("");
    try {
      const response = await fetch("/api/ims/shipping/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipmentIds: created.map((item) => item.shipmentId),
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to mark shipments dispatched.");
      const pending = (result.data ?? []).filter(
        (item: any) => item.shipmentStatus === "channel_pending",
      );
      setDispatchMessage(
        pending.length
          ? `${result.data.length} shipment${result.data.length === 1 ? "" : "s"} dispatched in Solvantis; ${pending.length} channel sync${pending.length === 1 ? "" : "s"} need retry.`
          : `${result.data.length} shipment${result.data.length === 1 ? "" : "s"} marked dispatched.`,
      );
      setSavedShipments((current) =>
        current.filter(
          (item) =>
            !(result.data ?? []).some(
              (done: any) =>
                done.shipmentId === item.shipmentId &&
                done.shipmentStatus === "complete",
            ),
        ),
      );
      if (!pending.length) {
        setCreated([]);
        setSubmissionResults([]);
        setSavedSelection(new Set());
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to mark shipments dispatched.",
      );
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ship orders"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "rgba(15,23,42,.58)",
        display: "grid",
        placeItems: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          maxHeight: "calc(100vh - 40px)",
          overflow: "auto",
          background: "var(--sv-bg-1)",
          border: "1px solid var(--sv-etch)",
          borderRadius: 8,
          boxShadow: "0 22px 60px rgba(0,0,0,.28)",
        }}
      >
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid var(--sv-etch)",
            background: "var(--sv-bg-1)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <PackageCheck size={19} color="var(--sv-action)" />
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>Shipping workspace</h2>
              <div
                style={{
                  marginTop: 2,
                  fontSize: 12,
                  color: "var(--sv-text-dim)",
                }}
              >
                {orders.length
                  ? `${orders.length} order${orders.length === 1 ? "" : "s"} selected`
                  : "Saved shipping operations"}
              </div>
            </div>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            style={iconButtonStyle}
          >
            <X size={17} />
          </button>
        </header>
        <div style={{ padding: 18 }}>
          <div
            role="tablist"
            aria-label="Shipping workspace views"
            style={{
              display: "flex",
              gap: 4,
              marginBottom: 16,
              borderBottom: "1px solid var(--sv-etch)",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "shipments"}
              onClick={() => setActiveTab("shipments")}
              style={tabButtonStyle(activeTab === "shipments")}
            >
              <PackageCheck size={14} />
              Shipments
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "manifests"}
              onClick={() => setActiveTab("manifests")}
              style={tabButtonStyle(activeTab === "manifests")}
            >
              <ClipboardList size={14} />
              Manifests
            </button>
          </div>
          {activeTab === "manifests" ? (
            <ManifestsWorkspacePanel />
          ) : (
            <>
              {loading && (
                <div style={{ color: "var(--sv-text-dim)", fontSize: 13 }}>
                  Checking order lines and delivery addresses...
                </div>
              )}
              {error && (
                <div
                  role="alert"
                  style={{ color: "var(--sv-red)", fontSize: 13 }}
                >
                  {error}
                </div>
              )}
              {dispatchMessage && (
                <div
                  role="status"
                  style={{
                    marginBottom: 12,
                    color: "var(--sv-green)",
                    fontSize: 13,
                  }}
                >
                  {dispatchMessage}
                </div>
              )}
              {!loading &&
                !created.length &&
                availableReadyOrders.length > 0 && (
                  <section style={{ marginBottom: 18 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        marginBottom: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 13 }}>
                          Orders ready to ship
                        </strong>
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: 11,
                            color: "var(--sv-text-dim)",
                          }}
                        >
                          Confirmed delivery orders without an active
                          consignment.
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={!readySelection.size || addingOrders}
                        onClick={addReadyOrders}
                        style={{
                          ...primaryButtonStyle,
                          opacity:
                            readySelection.size && !addingOrders ? 1 : 0.55,
                        }}
                      >
                        <Plus size={14} />
                        {addingOrders ? "Adding..." : "Add selected"}
                      </button>
                    </div>
                    <div style={{ borderTop: "1px solid var(--sv-etch)" }}>
                      {availableReadyOrders.map((order) => (
                        <label
                          key={order.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "24px repeat(auto-fit,minmax(140px,1fr))",
                            gap: 10,
                            alignItems: "center",
                            padding: "10px 4px",
                            borderBottom: "1px solid var(--sv-etch)",
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={readySelection.has(Number(order.id))}
                            onChange={(event) =>
                              setReadySelection((current) => {
                                const next = new Set(current);
                                if (event.target.checked)
                                  next.add(Number(order.id));
                                else next.delete(Number(order.id));
                                return next;
                              })
                            }
                          />
                          <span>
                            <strong>{order.so_number}</strong>
                            {getChannelOrderNumber(order) && (
                              <span
                                style={{
                                  display: "block",
                                  color: "var(--sv-text-dim)",
                                }}
                              >
                                {getChannelOrderNumber(order)}
                              </span>
                            )}
                          </span>
                          <span>
                            {order.customer_name || "No customer name"}
                          </span>
                          <span style={{ color: "var(--sv-text-dim)" }}>
                            {destinationLabel(order.delivery_country)}
                          </span>
                          <span>
                            {formatChannelShippingMethod(order) || "Delivery"}
                          </span>
                          <span
                            style={{
                              color: "var(--sv-text-dim)",
                              fontWeight: 700,
                            }}
                          >
                            {Number(order.remaining_quantity || 0)} unit
                            {Number(order.remaining_quantity || 0) === 1
                              ? ""
                              : "s"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                )}
              {!loading && !created.length && savedBatches.length > 0 && (
                <section style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      marginBottom: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: 13 }}>
                        Prepared &amp; labelled batches
                      </strong>
                      <div
                        style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: "var(--sv-text-dim)",
                        }}
                      >
                        A batch can contain several customer consignments. Open
                        it to continue its next action.
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    {savedBatches.map((batch) => {
                      const canDelete = batch.shipments.every((shipment) =>
                        canDeleteShippingDraft(
                          shipment.status,
                          shipment.providerShipmentId,
                        ),
                      );
                      return (
                        <div
                          key={batch.batchId}
                          style={{
                            border: "1px solid var(--sv-etch)",
                            borderRadius: 6,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              padding: 10,
                              background: "var(--sv-bg-2)",
                              flexWrap: "wrap",
                            }}
                          >
                            <span>
                              <strong>
                                {batch.shipments.length} consignment
                                {batch.shipments.length === 1 ? "" : "s"}
                              </strong>
                              <span
                                style={{
                                  display: "block",
                                  color: "var(--sv-text-dim)",
                                  fontSize: 11,
                                }}
                              >
                                {batchStatusLabel(batch.shipments)}
                              </span>
                            </span>
                            <span style={{ display: "flex", gap: 8 }}>
                              <button
                                type="button"
                                disabled={deleting}
                                onClick={() =>
                                  openSavedShipments(batch.shipments)
                                }
                                style={secondaryButtonStyle}
                              >
                                Open batch
                              </button>
                              <button
                                type="button"
                                disabled={deleting || !canDelete}
                                onClick={() =>
                                  void deleteSavedShipments(batch.shipments)
                                }
                                title="Only batches not submitted to a carrier can be deleted"
                                style={{
                                  ...secondaryButtonStyle,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  color: "var(--sv-red)",
                                  opacity: canDelete && !deleting ? 1 : 0.55,
                                }}
                              >
                                <Trash2 size={14} />
                                {deleting ? "Deleting..." : "Delete batch"}
                              </button>
                            </span>
                          </div>
                          {batch.shipments.map((shipment) => (
                            <div
                              key={shipment.shipmentId}
                              style={{
                                display: "grid",
                                gridTemplateColumns:
                                  "repeat(auto-fit,minmax(150px,1fr))",
                                gap: 10,
                                alignItems: "center",
                                padding: "10px 12px 10px 44px",
                                borderTop: "1px solid var(--sv-etch)",
                                fontSize: 12,
                              }}
                            >
                              <span>
                                <strong>{shipment.soNumber}</strong>
                                {shipment.channelOrderNumber && (
                                  <span
                                    style={{
                                      display: "block",
                                      color: "var(--sv-text-dim)",
                                    }}
                                  >
                                    {shipment.channelOrderNumber}
                                  </span>
                                )}
                              </span>
                              <span>
                                {shipment.customerName || "No customer name"}
                                <span
                                  style={{
                                    display: "block",
                                    color: "var(--sv-text-dim)",
                                  }}
                                >
                                  {destinationLabel(
                                    shipment.destinationCountry,
                                    shipment.isInternational,
                                  )}
                                </span>
                              </span>
                              <span>
                                {shipment.serviceName || "Service not selected"}
                                {shipment.quotedCost != null && (
                                  <span
                                    style={{
                                      display: "block",
                                      color: "var(--sv-text-dim)",
                                    }}
                                  >
                                    {formatAud(shipment.quotedCost)} quoted
                                  </span>
                                )}
                              </span>
                              <span
                                style={{
                                  color:
                                    shipment.status === "label_ready"
                                      ? "var(--sv-action)"
                                      : "var(--sv-text-dim)",
                                  fontWeight: 700,
                                }}
                              >
                                {shippingStatusLabel(shipment.status)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
              {!loading && !created.length && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", width: "min(360px,100%)" }}>
                    <span
                      style={{
                        display: "block",
                        marginBottom: 5,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      Carrier account
                    </span>
                    <select
                      value={carrierAccountId}
                      onChange={(event) => {
                        setCarrierAccountId(event.target.value);
                        setError("");
                        setQuotesByOrder({});
                        setSelectedServiceByOrder({});
                      }}
                      style={selectStyle}
                    >
                      <option value="">Choose an account</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.displayName}
                          {account.verifiedAt ? "" : " (not verified)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedAccount?.dispatchAddressMissingFields.length ? (
                    <div
                      role="alert"
                      style={{
                        marginTop: 7,
                        fontSize: 12,
                        color: "var(--sv-red)",
                      }}
                    >
                      Dispatch location{" "}
                      <strong>
                        {selectedAccount.dispatchLocationName || "not selected"}
                      </strong>{" "}
                      is missing{" "}
                      {selectedAccount.dispatchAddressMissingFields.join(", ")}.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          window.location.hash = "locations";
                        }}
                        style={linkButtonStyle}
                      >
                        Update location
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
              {!loading &&
                !created.length &&
                plans.map(
                  ({
                    order,
                    remainingQuantity,
                    eligibility,
                    hasAddress,
                    ready,
                    suggestion,
                  }) => {
                    const orderParcels = parcelsByOrder[order.id] ?? [];
                    const rates = quotesByOrder[order.id] ?? [];
                    const parcelIssue = editableParcelIssue(
                      order,
                      orderParcels,
                    );
                    const exportPurpose =
                      exportPurposeByOrder[order.id] ?? "sale";
                    const customsRows = customsRowsForOrder(
                      order,
                      orderParcels,
                      exportPurpose,
                      nonSaleValuesByOrder[order.id] ?? {},
                    );
                    const customsBlockers = customsBlockersForOrder(
                      order,
                      orderParcels,
                      exportPurpose,
                      nonSaleValuesByOrder[order.id] ?? {},
                      confirmedNonSaleOrders.has(order.id),
                    );
                    const international = isInternationalOrder(order);
                    return (
                      <div
                        key={order.id}
                        style={{
                          padding: "14px 0",
                          borderBottom: "1px solid var(--sv-etch)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit,minmax(160px,1fr))",
                            gap: 14,
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <strong style={{ fontSize: 13 }}>
                              {order.so_number}
                            </strong>
                            {getChannelOrderNumber(order) && (
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 11,
                                  color: "var(--sv-text-dim)",
                                }}
                              >
                                Channel Order # {getChannelOrderNumber(order)}
                              </div>
                            )}
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--sv-text-dim)",
                              }}
                            >
                              {remainingQuantity} unit
                              {remainingQuantity === 1 ? "" : "s"} remaining
                            </div>
                          </div>
                          <div style={{ fontSize: 12 }}>
                            {order.customer_name || "No customer name"}
                            {formatChannelShippingMethod(order) && (
                              <div
                                style={{
                                  marginTop: 2,
                                  fontSize: 11,
                                  color: "var(--sv-text-dim)",
                                }}
                              >
                                {formatChannelShippingMethod(order)}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--sv-text-dim)",
                            }}
                          >
                            {hasAddress
                              ? [
                                  order.delivery_address,
                                  order.delivery_suburb,
                                  order.delivery_state,
                                  order.delivery_postcode,
                                  order.delivery_country,
                                ]
                                  .filter(Boolean)
                                  .join(", ")
                              : "Delivery address is incomplete"}
                            <span style={{ display: "block", marginTop: 2 }}>
                              {destinationLabel(
                                order.delivery_country,
                                international,
                              )}
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: ready
                                ? "var(--sv-green)"
                                : "var(--sv-red)",
                            }}
                          >
                            {ready
                              ? "Ready"
                              : eligibility.eligible
                                ? "Address required"
                                : eligibility.reason}
                          </span>
                        </div>
                        {ready && (
                          <div
                            style={{ marginTop: 12, display: "grid", gap: 10 }}
                          >
                            {suggestion.unpacked.length > 0 && (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--sv-text-dim)",
                                }}
                              >
                                Automatic packing was unavailable for{" "}
                                {suggestion.unpacked.length} item
                                {suggestion.unpacked.length === 1 ? "" : "s"}.
                                Enter the packed parcel details below.
                              </div>
                            )}
                            {orderParcels.map((parcel, parcelIndex) => (
                              <div
                                key={parcelIndex}
                                style={{
                                  padding: 10,
                                  border: "1px solid var(--sv-etch)",
                                  borderRadius: 6,
                                  background: "var(--sv-bg-2)",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    marginBottom: 8,
                                  }}
                                >
                                  <span
                                    style={{ fontSize: 12, fontWeight: 700 }}
                                  >
                                    Parcel {parcelIndex + 1}
                                  </span>
                                  {orderParcels.length > 1 && (
                                    <button
                                      type="button"
                                      title={`Remove parcel ${parcelIndex + 1}`}
                                      onClick={() =>
                                        removeParcel(order.id, parcelIndex)
                                      }
                                      style={smallIconButtonStyle}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  )}
                                </div>
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                      "repeat(auto-fit,minmax(130px,1fr))",
                                    gap: 8,
                                  }}
                                >
                                  <label style={fieldStyle}>
                                    <span>Preset (optional)</span>
                                    <select
                                      value={parcel.packagePresetId}
                                      onChange={(event) =>
                                        choosePreset(
                                          order.id,
                                          parcelIndex,
                                          event.target.value,
                                        )
                                      }
                                      style={selectStyle}
                                    >
                                      <option value="">
                                        Manual dimensions
                                      </option>
                                      {presets.map((preset) => (
                                        <option
                                          key={preset.id}
                                          value={preset.id}
                                        >
                                          {preset.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <ParcelNumberField
                                    label="Length (mm)"
                                    value={parcel.lengthMm}
                                    onChange={(value) =>
                                      updateParcel(order.id, parcelIndex, {
                                        lengthMm: value,
                                      })
                                    }
                                  />
                                  <ParcelNumberField
                                    label="Width (mm)"
                                    value={parcel.widthMm}
                                    onChange={(value) =>
                                      updateParcel(order.id, parcelIndex, {
                                        widthMm: value,
                                      })
                                    }
                                  />
                                  <ParcelNumberField
                                    label="Height (mm)"
                                    value={parcel.heightMm}
                                    onChange={(value) =>
                                      updateParcel(order.id, parcelIndex, {
                                        heightMm: value,
                                      })
                                    }
                                  />
                                  <ParcelNumberField
                                    label="Packed weight (kg)"
                                    value={parcel.weightKg}
                                    step="0.001"
                                    onChange={(value) =>
                                      updateParcel(order.id, parcelIndex, {
                                        weightKg: value,
                                      })
                                    }
                                  />
                                </div>
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns:
                                      "repeat(auto-fit,minmax(150px,1fr))",
                                    gap: 8,
                                    marginTop: 9,
                                  }}
                                >
                                  {(order.items ?? []).map((item) => {
                                    const remaining = Math.max(
                                      0,
                                      Number(item.qty_ordered) -
                                        Number(item.qty_fulfilled),
                                    );
                                    if (remaining <= 0) return null;
                                    const allocation = parcel.allocations.find(
                                      (value) =>
                                        value.soItemId === Number(item.id),
                                    );
                                    return (
                                      <ParcelNumberField
                                        key={item.id}
                                        label={`${item.sku || item.product_name || `Item ${item.id}`} (of ${remaining})`}
                                        value={
                                          allocation?.quantity
                                            ? String(allocation.quantity)
                                            : ""
                                        }
                                        step="0.0001"
                                        onChange={(value) =>
                                          updateAllocation(
                                            order.id,
                                            parcelIndex,
                                            Number(item.id),
                                            value,
                                          )
                                        }
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                            <div>
                              <button
                                type="button"
                                onClick={() => addParcel(order)}
                                style={{
                                  ...secondaryButtonStyle,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <Plus size={14} />
                                Add parcel
                              </button>
                            </div>
                            {parcelIssue && (
                              <div
                                role="status"
                                style={{ fontSize: 11, color: "var(--sv-red)" }}
                              >
                                {parcelIssue}
                              </div>
                            )}
                            {international && (
                              <section
                                aria-label={`Customs declaration for ${order.so_number}`}
                                style={{ marginTop: 8, minWidth: 0 }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "end",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 8,
                                  }}
                                >
                                  <div>
                                    <strong style={{ fontSize: 13 }}>
                                      Customs declaration
                                    </strong>
                                    <div style={{ fontSize: 11, color: "var(--sv-text-dim)" }}>
                                      Values are declared in AUD and quantities follow the parcel allocations above.
                                    </div>
                                  </div>
                                  <label style={{ ...fieldStyle, width: "min(220px,100%)" }}>
                                    <span>Export purpose</span>
                                    <select
                                      value={exportPurpose}
                                      onChange={(event) =>
                                        changeExportPurpose(
                                          order,
                                          event.target.value as ShippingExportPurpose,
                                        )
                                      }
                                      style={selectStyle}
                                    >
                                      <option value="sale">Sale</option>
                                      <option value="gift">Gift</option>
                                      <option value="sample">Sample</option>
                                      <option value="return">Return</option>
                                    </select>
                                  </label>
                                </div>
                                <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                                  <table
                                    style={{
                                      width: "100%",
                                      minWidth: 760,
                                      borderCollapse: "collapse",
                                      fontSize: 11,
                                    }}
                                  >
                                    <thead>
                                      <tr style={{ color: "var(--sv-text-dim)", textAlign: "left" }}>
                                        <th style={customsCellStyle}>Product / SKU</th>
                                        <th style={customsCellStyle}>Description</th>
                                        <th style={customsCellStyle}>HS code</th>
                                        <th style={customsCellStyle}>Origin</th>
                                        <th style={{ ...customsCellStyle, textAlign: "right" }}>Qty</th>
                                        <th style={{ ...customsCellStyle, textAlign: "right" }}>Unit AUD</th>
                                        <th style={{ ...customsCellStyle, textAlign: "right" }}>Total AUD</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {customsRows.map((row) => (
                                        <tr key={row.id} style={{ borderTop: "1px solid var(--sv-etch)" }}>
                                          <td style={customsCellStyle}>
                                            <strong>{row.productName || row.sku}</strong>
                                            <span style={{ display: "block", color: "var(--sv-text-dim)" }}>
                                              {row.sku || `Line ${row.id}`}
                                            </span>
                                            {row.errors.length > 0 && row.productId && (
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  onClose();
                                                  window.location.hash = `products/${encodeURIComponent(row.productId!)}`;
                                                }}
                                                style={linkButtonStyle}
                                              >
                                                Update product
                                              </button>
                                            )}
                                          </td>
                                          <td style={customsCellStyle}>{row.customsDescription || "Missing"}</td>
                                          <td style={customsCellStyle}>{row.hsCode || "Missing"}</td>
                                          <td style={customsCellStyle}>{row.countryOfOrigin || "Missing"}</td>
                                          <td style={{ ...customsCellStyle, textAlign: "right" }}>{formatQuantity(row.quantity)}</td>
                                          <td style={{ ...customsCellStyle, textAlign: "right" }}>
                                            {exportPurpose === "sale" ? (
                                              row.unitValue == null ? "Unavailable" : formatAud(row.unitValue)
                                            ) : (
                                              <input
                                                type="number"
                                                min="0.01"
                                                step="0.01"
                                                aria-label={`${row.sku || row.productName} declared unit value AUD`}
                                                value={nonSaleValuesByOrder[order.id]?.[row.id] ?? ""}
                                                onChange={(event) => {
                                                  const value = event.target.value;
                                                  setNonSaleValuesByOrder((current) => ({
                                                    ...current,
                                                    [order.id]: {
                                                      ...(current[order.id] ?? {}),
                                                      [row.id]: value,
                                                    },
                                                  }));
                                                  setConfirmedNonSaleOrders((current) => {
                                                    const next = new Set(current);
                                                    next.delete(order.id);
                                                    return next;
                                                  });
                                                  setQuotesByOrder({});
                                                  setSelectedServiceByOrder({});
                                                }}
                                                style={{ ...selectStyle, width: 100, textAlign: "right" }}
                                              />
                                            )}
                                          </td>
                                          <td style={{ ...customsCellStyle, textAlign: "right", fontWeight: 700 }}>
                                            {row.totalValue == null ? "-" : formatAud(row.totalValue)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr style={{ borderTop: "1px solid var(--sv-etch)" }}>
                                        <td colSpan={6} style={{ ...customsCellStyle, textAlign: "right", fontWeight: 700 }}>
                                          Declaration total AUD
                                        </td>
                                        <td style={{ ...customsCellStyle, textAlign: "right", fontWeight: 700 }}>
                                          {formatAud(customsRows.reduce((sum, row) => sum + Number(row.totalValue ?? 0), 0))}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                                {exportPurpose !== "sale" && (
                                  <label
                                    style={{
                                      display: "flex",
                                      alignItems: "flex-start",
                                      gap: 8,
                                      marginTop: 10,
                                      fontSize: 12,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={confirmedNonSaleOrders.has(order.id)}
                                      onChange={(event) => {
                                        setConfirmedNonSaleOrders((current) => {
                                          const next = new Set(current);
                                          if (event.target.checked) next.add(order.id);
                                          else next.delete(order.id);
                                          return next;
                                        });
                                        setError("");
                                        setQuotesByOrder({});
                                        setSelectedServiceByOrder({});
                                      }}
                                    />
                                    I confirm these non-sale declared values are complete and accurate.
                                  </label>
                                )}
                                {customsBlockers.length > 0 && (
                                  <div role="alert" style={{ marginTop: 8, color: "var(--sv-red)", fontSize: 11 }}>
                                    {customsBlockers.map((message) => (
                                      <div key={message}>{message}</div>
                                    ))}
                                  </div>
                                )}
                              </section>
                            )}
                            {rates.length > 0 && (
                              <fieldset
                                style={{ margin: 0, padding: 0, border: 0 }}
                              >
                                <legend
                                  style={{
                                    marginBottom: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: "var(--sv-text-dim)",
                                  }}
                                >
                                  Choose shipping service
                                </legend>
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 8,
                                  }}
                                >
                                  {rates.map((rate) => {
                                    const selected =
                                      selectedServiceByOrder[order.id]
                                        ?.serviceCode === rate.serviceCode;
                                    return (
                                      <label
                                        key={rate.serviceCode}
                                        style={{
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 7,
                                          padding: "7px 9px",
                                          border: `1px solid ${selected ? "var(--sv-action)" : "var(--sv-etch)"}`,
                                          borderRadius: 6,
                                          background: selected
                                            ? "var(--sv-action-soft)"
                                            : "var(--sv-bg-1)",
                                          fontSize: 12,
                                          cursor: "pointer",
                                        }}
                                      >
                                        <input
                                          type="radio"
                                          name={`shipping-service-${order.id}`}
                                          checked={selected}
                                          onChange={() => {
                                            setSelectedServiceByOrder(
                                              (current) => ({
                                                ...current,
                                                [order.id]: rate,
                                              }),
                                            );
                                            setError("");
                                          }}
                                        />
                                        <span>
                                          <strong>{rate.serviceName}</strong> ·{" "}
                                          {formatAud(rate.total)}{" "}
                                          <span
                                            style={{
                                              color: "var(--sv-text-dim)",
                                            }}
                                          >
                                            incl. GST
                                          </span>
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </fieldset>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  },
                )}
              {created.length > 0 && (
                <div
                  role="status"
                  style={{
                    padding: 14,
                    border: "1px solid var(--sv-etch)",
                    borderRadius: 6,
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    {submissionResults.length
                      ? "Australia Post submission"
                      : "Shipment drafts prepared"}
                  </strong>
                  <div
                    style={{
                      marginTop: 4,
                      color: "var(--sv-text-dim)",
                      fontSize: 12,
                    }}
                  >
                    {submissionResults.length
                      ? `${submissionResults.length} shipment${submissionResults.length === 1 ? "" : "s"} created with Australia Post.`
                      : `${created.length} shipment${created.length === 1 ? "" : "s"} saved locally. Review and confirm the billable carrier submission.`}
                  </div>
                  {!submissionResults.length &&
                    created.map((item) => {
                      const order = details.find(
                        (detail) => Number(detail.id) === item.soId,
                      );
                      const service = selectedServiceByOrder[item.soId];
                      return (
                        <div
                          key={item.shipmentId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px solid var(--sv-etch)",
                            fontSize: 12,
                          }}
                        >
                          <strong>
                            {order?.so_number ?? `Shipment ${item.shipmentId}`}
                          </strong>
                          <span>
                            {service?.serviceName} ·{" "}
                            {service ? formatAud(service.total) : ""} incl. GST
                          </span>
                        </div>
                      );
                    })}
                  {[
                    ...new Map(
                      submissionResults
                        .filter((result) => result.labelUrl)
                        .map((result) => [result.labelUrl, result]),
                    ).values(),
                  ].map((result, index) => (
                    <div
                      key={result.labelUrl}
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 10,
                      }}
                    >
                      <a
                        href={result.labelUrl!}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...secondaryButtonStyle,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textDecoration: "none",
                        }}
                      >
                        <Download size={14} />
                        {labelDownloadButtonLabel(
                          submissionResults.filter(
                            (item) => item.labelUrl === result.labelUrl,
                          ),
                          selectedServiceByOrder,
                          savedShipments,
                          details,
                          index,
                        )}
                      </a>
                    </div>
                  ))}
                  {submissionResults.map((result) => {
                    const order = details.find(
                      (item) => Number(item.id) === result.soId,
                    );
                    const saved = savedShipments.find(
                      (item) => item.shipmentId === result.shipmentId,
                    );
                    return (
                      <div
                        key={result.shipmentId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          marginTop: 10,
                          paddingTop: 10,
                          borderTop: "1px solid var(--sv-etch)",
                          fontSize: 12,
                        }}
                      >
                        <strong>
                          {order?.so_number ??
                            saved?.soNumber ??
                            `Shipment ${result.shipmentId}`}
                        </strong>
                        <span style={{ color: "var(--sv-text-dim)" }}>
                          {result.chargedCost == null
                            ? ""
                            : `${formatAud(result.chargedCost)} charged`}
                        </span>
                        <span
                          style={{
                            marginLeft: "auto",
                            color:
                              result.status === "label_ready"
                                ? "var(--sv-green)"
                                : "var(--sv-text-dim)",
                          }}
                        >
                          {result.status === "label_ready"
                            ? "Label ready"
                            : "Label processing"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {!loading && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 8,
                    marginTop: 18,
                    flexWrap: "wrap",
                  }}
                >
                  <button
                    type="button"
                    onClick={onClose}
                    style={secondaryButtonStyle}
                  >
                    {created.length ? "Close" : "Cancel"}
                  </button>
                  {!created.length && (
                    <button
                      type="button"
                      disabled={!canCreate || quoting || saving}
                      onClick={getQuotes}
                      style={{
                        ...secondaryButtonStyle,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        opacity: canCreate && !quoting && !saving ? 1 : 0.55,
                        cursor:
                          canCreate && !quoting && !saving
                            ? "pointer"
                            : "not-allowed",
                      }}
                    >
                      <RefreshCw size={15} />
                      {quoting
                        ? "Getting prices..."
                        : Object.keys(quotesByOrder).length
                          ? "Refresh prices"
                          : "Get shipping prices"}
                    </button>
                  )}
                  {!created.length && (
                    <button
                      type="button"
                      disabled={!canCreate || !hasSelectedServices || saving}
                      onClick={createDrafts}
                      title={
                        canCreate && !hasSelectedServices
                          ? "Choose a quoted shipping service for every order."
                          : undefined
                      }
                      style={{
                        ...primaryButtonStyle,
                        opacity:
                          canCreate && hasSelectedServices && !saving
                            ? 1
                            : 0.55,
                        cursor:
                          canCreate && hasSelectedServices && !saving
                            ? "pointer"
                            : "not-allowed",
                      }}
                    >
                      <PackageCheck size={15} />
                      {saving ? "Preparing..." : "Prepare Shipments"}
                    </button>
                  )}
                  {created.length > 0 && needsCarrierAction && (
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={submitToCarrier}
                      style={{
                        ...primaryButtonStyle,
                        opacity: submitting ? 0.55 : 1,
                        cursor: submitting ? "not-allowed" : "pointer",
                      }}
                    >
                      <Send size={15} />
                      {submitting
                        ? "Submitting..."
                        : labelsPending
                          ? "Check label status"
                          : "Submit to Australia Post & create labels"}
                    </button>
                  )}
                  {created.length > 0 &&
                    submissionResults.length === created.length &&
                    submissionResults.every(
                      (result) => result.status === "label_ready",
                    ) && (
                      <button
                        type="button"
                        disabled={dispatching}
                        onClick={markDispatched}
                        style={{
                          ...primaryButtonStyle,
                          opacity: dispatching ? 0.55 : 1,
                          cursor: dispatching ? "not-allowed" : "pointer",
                        }}
                      >
                        <PackageCheck size={15} />
                        {dispatching ? "Updating orders..." : "Mark dispatched"}
                      </button>
                    )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `The server returned an invalid response (${response.status}). Refresh the page and try again.`,
    );
  }
}

function ManifestsWorkspacePanel() {
  const [candidates, setCandidates] = useState<ManifestCandidateRow[]>([]);
  const [manifests, setManifests] = useState<ManifestSummaryRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ims/shipping/manifests");
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to load manifests.");
      setCandidates(result.data?.candidates ?? []);
      setManifests(result.data?.manifests ?? []);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load manifests.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const groups = new Map<string, ManifestCandidateRow[]>();
  for (const candidate of candidates) {
    const key = manifestGroupKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const selectedRows = candidates.filter((candidate) =>
    selected.has(candidate.shipmentId),
  );
  const createManifest = async () => {
    if (!selectedRows.length) return;
    if (
      !window.confirm(
        `Create the ${selectedRows[0].carrierName} booking and close a manifest containing ${selectedRows.length} shipment${selectedRows.length === 1 ? "" : "s"}?`,
      )
    )
      return;
    setCreating(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/ims/shipping/manifests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationKey: crypto.randomUUID(),
          shipmentIds: selectedRows.map((row) => row.shipmentId),
        }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(
          result.error || "Unable to create the carrier manifest.",
        );
      setMessage(
        `Manifest ${result.data.providerOrderId || result.data.providerReference} created. Print and sign the carrier summary for lodgement.`,
      );
      setSelected(new Set());
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create the carrier manifest.",
      );
    } finally {
      setCreating(false);
    }
  };
  const reconcile = async (manifest: ManifestSummaryRow) => {
    const providerOrderId = window.prompt(
      "Enter the Australia Post order ID after confirming this booking in the carrier portal.",
    );
    if (!providerOrderId?.trim()) return;
    setCreating(true);
    setError("");
    try {
      const response = await fetch(
        `/api/ims/shipping/manifests/${manifest.id}/reconcile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerOrderId }),
        },
      );
      const result = await readJsonResponse(response);
      if (!response.ok || !result.success)
        throw new Error(result.error || "Unable to reconcile the manifest.");
      setMessage(
        `Manifest ${result.data.providerOrderId} reconciled and ready to print.`,
      );
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to reconcile the manifest.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div role="tabpanel">
      {loading && (
        <div style={{ color: "var(--sv-text-dim)", fontSize: 13 }}>
          Loading dispatched shipments and manifest history...
        </div>
      )}
      {error && (
        <div
          role="alert"
          style={{ marginBottom: 12, color: "var(--sv-red)", fontSize: 13 }}
        >
          {error}
        </div>
      )}
      {message && (
        <div
          role="status"
          style={{ marginBottom: 12, color: "var(--sv-green)", fontSize: 13 }}
        >
          {message}
        </div>
      )}
      {!loading && groups.size === 0 && (
        <div
          style={{
            marginBottom: 18,
            color: "var(--sv-text-dim)",
            fontSize: 13,
          }}
        >
          No dispatched, unmanifested shipments are ready. Create labels and
          mark parcels dispatched first.
        </div>
      )}
      {[...groups.entries()].map(([key, rows]) => {
        const groupSelected = rows.filter((row) =>
          selected.has(row.shipmentId),
        );
        return (
          <section
            key={key}
            style={{
              marginBottom: 18,
              border: "1px solid var(--sv-etch)",
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                padding: 12,
                background: "var(--sv-bg-2)",
                flexWrap: "wrap",
              }}
            >
              <div>
                <strong style={{ fontSize: 13 }}>{rows[0].carrierName}</strong>
                <div style={{ fontSize: 11, color: "var(--sv-text-dim)" }}>
                  {rows[0].dispatchLocationName || "No dispatch location"} ·{" "}
                  {rows.reduce((sum, row) => sum + row.parcelCount, 0)} parcel
                  {rows.reduce((sum, row) => sum + row.parcelCount, 0) === 1
                    ? ""
                    : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    new Set(
                      groupSelected.length === rows.length
                        ? []
                        : rows.map((row) => row.shipmentId),
                    ),
                  )
                }
                style={secondaryButtonStyle}
              >
                {groupSelected.length === rows.length
                  ? "Clear group"
                  : "Select group"}
              </button>
            </div>
            {rows.map((row) => (
              <label
                key={row.shipmentId}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "24px minmax(150px,1fr) minmax(120px,.8fr) auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  borderTop: "1px solid var(--sv-etch)",
                  fontSize: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.shipmentId)}
                  onChange={(event) =>
                    setSelected((current) => {
                      const next =
                        manifestGroupKey(row) ===
                        manifestGroupKey(selectedRows[0] ?? row)
                          ? new Set(current)
                          : new Set<number>();
                      if (event.target.checked) next.add(row.shipmentId);
                      else next.delete(row.shipmentId);
                      return next;
                    })
                  }
                />
                <span>
                  <strong>{row.soNumber}</strong>
                  {row.channelOrderNumber && (
                    <span
                      style={{ display: "block", color: "var(--sv-text-dim)" }}
                    >
                      {row.channelOrderNumber}
                    </span>
                  )}
                </span>
                <span>
                  {row.parcelCount} parcel{row.parcelCount === 1 ? "" : "s"}
                </span>
                <span>
                  {row.chargedCost == null ? "" : formatAud(row.chargedCost)}
                </span>
              </label>
            ))}
          </section>
        );
      })}
      {selectedRows.length > 0 && (
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginBottom: 22,
          }}
        >
          <button
            type="button"
            disabled={creating}
            onClick={createManifest}
            style={{ ...primaryButtonStyle, opacity: creating ? 0.55 : 1 }}
          >
            <ClipboardList size={15} />
            {creating ? "Creating booking..." : "Create booking & manifest"}
          </button>
        </div>
      )}
      {!loading && (
        <section>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              marginBottom: 8,
            }}
          >
            <strong style={{ fontSize: 13 }}>Manifest history</strong>
            <button
              type="button"
              title="Refresh manifests"
              onClick={() => void load()}
              style={smallIconButtonStyle}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {manifests.length === 0 ? (
            <div style={{ color: "var(--sv-text-dim)", fontSize: 12 }}>
              No manifests have been created.
            </div>
          ) : (
            manifests.map((manifest) => (
              <div
                key={manifest.id}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "minmax(180px,1fr) minmax(130px,.7fr) auto",
                  gap: 12,
                  alignItems: "center",
                  padding: "10px 4px",
                  borderTop: "1px solid var(--sv-etch)",
                  fontSize: 12,
                }}
              >
                <span>
                  <strong>
                    {manifest.providerOrderId || manifest.providerReference}
                  </strong>
                  <span
                    style={{ display: "block", color: "var(--sv-text-dim)" }}
                  >
                    {manifest.carrierName} ·{" "}
                    {manifest.dispatchLocationName || "No dispatch location"}
                  </span>
                  {manifest.orders.length > 0 && (
                    <span
                      style={{
                        display: "block",
                        marginTop: 4,
                        color: "var(--sv-text-dim)",
                        fontSize: 11,
                      }}
                    >
                      {manifest.orders
                        .map(
                          (order) => order.channelOrderNumber || order.soNumber,
                        )
                        .join(", ")}
                    </span>
                  )}
                </span>
                <span>
                  {manifest.shipmentCount} shipment
                  {manifest.shipmentCount === 1 ? "" : "s"} ·{" "}
                  {manifest.parcelCount} parcel
                  {manifest.parcelCount === 1 ? "" : "s"}
                  <span
                    style={{
                      display: "block",
                      color:
                        manifest.status === "complete"
                          ? "var(--sv-green)"
                          : manifest.status === "submission_unknown"
                            ? "var(--sv-red)"
                            : "var(--sv-text-dim)",
                      fontWeight: 700,
                    }}
                  >
                    {manifestStatusLabel(manifest.status)}
                  </span>
                </span>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {manifest.status === "complete" ? (
                    <>
                      {manifest.labelLayouts.map((layout) => (
                        <a
                          key={layout}
                          href={`/api/ims/shipping/manifests/${manifest.id}/labels?layout=${encodeURIComponent(layout)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            ...secondaryButtonStyle,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            textDecoration: "none",
                          }}
                        >
                          <Download size={14} />
                          {manifestLabelButtonLabel(layout)}
                        </a>
                      ))}
                      <a
                        href={`/api/ims/shipping/manifests/${manifest.id}/summary`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          ...secondaryButtonStyle,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          textDecoration: "none",
                        }}
                      >
                        <Printer size={14} />
                        Print manifest
                      </a>
                    </>
                  ) : manifest.status === "submission_unknown" ? (
                    <button
                      type="button"
                      disabled={creating}
                      onClick={() => void reconcile(manifest)}
                      style={secondaryButtonStyle}
                    >
                      Reconcile
                    </button>
                  ) : null}
                </span>
                {manifest.safeError && (
                  <span
                    style={{
                      gridColumn: "1 / -1",
                      color: "var(--sv-red)",
                      fontSize: 11,
                    }}
                  >
                    {manifest.safeError}
                  </span>
                )}
              </div>
            ))
          )}
        </section>
      )}
    </div>
  );
}

function manifestGroupKey(
  row: Pick<
    ManifestCandidateRow,
    "provider" | "carrierAccountId" | "dispatchLocationId"
  >,
): string {
  return `${row.provider}:${row.carrierAccountId}:${row.dispatchLocationId ?? "none"}`;
}

function manifestStatusLabel(status: string): string {
  if (status === "complete") return "Ready to print";
  if (status === "submission_unknown") return "Carrier outcome needs review";
  if (status === "failed") return "Not created";
  return "Creating";
}

const iconButtonStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  display: "grid",
  placeItems: "center",
  border: "1px solid var(--sv-etch)",
  borderRadius: 6,
  background: "var(--sv-bg-1)",
  color: "var(--sv-text-main)",
  cursor: "pointer",
};
const smallIconButtonStyle: React.CSSProperties = {
  ...iconButtonStyle,
  width: 28,
  height: 28,
};
const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 12px",
  border: "1px solid var(--sv-etch)",
  borderRadius: 6,
  background: "var(--sv-bg-1)",
  color: "var(--sv-text-main)",
  fontWeight: 700,
  cursor: "pointer",
};
const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "8px 12px",
  border: 0,
  borderRadius: 6,
  background: "var(--sv-action)",
  color: "#fff",
  fontWeight: 700,
};
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid var(--sv-etch)",
  borderRadius: 6,
  background: "var(--sv-bg-1)",
  color: "var(--sv-text-main)",
};
const fieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
  color: "var(--sv-text-dim)",
  fontSize: 11,
  fontWeight: 700,
};
const linkButtonStyle: React.CSSProperties = {
  padding: 0,
  border: 0,
  background: "transparent",
  color: "var(--sv-action)",
  font: "inherit",
  fontWeight: 700,
  textDecoration: "underline",
  cursor: "pointer",
};
const tabButtonStyle = (active: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  border: 0,
  borderBottom: `2px solid ${active ? "var(--sv-action)" : "transparent"}`,
  background: "transparent",
  color: active ? "var(--sv-action)" : "var(--sv-text-dim)",
  fontWeight: 700,
  cursor: "pointer",
});
const customsCellStyle: React.CSSProperties = {
  padding: "7px 8px",
  verticalAlign: "top",
};

function ParcelNumberField({
  label,
  value,
  step = "1",
  onChange,
}: {
  label: string;
  value: string;
  step?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={fieldStyle}>
      <span>{label}</span>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={selectStyle}
      />
    </label>
  );
}

function buildPackingPlan(order: SalesOrderDetail, presets: PackingPreset[]) {
  const remainingQuantity = (order.items ?? []).reduce(
    (sum, item) =>
      sum + Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)),
    0,
  );
  const eligibility = getShippingOrderEligibility({
    status: order.status as any,
    soType: order.so_type,
    channelDeliveryType: order.channel_delivery_type,
    isPosLedger: order.is_pos_ledger,
    remainingQuantity,
  });
  const hasAddress = shippingAddressReady(order);
  const units: PackableUnit[] = [];
  for (const item of order.items ?? []) {
    let remaining = Math.max(
      0,
      Number(item.qty_ordered) - Number(item.qty_fulfilled),
    );
    let unitNumber = 1;
    while (remaining > 0) {
      const quantity = Math.min(1, remaining);
      units.push({
        soItemId: item.id,
        reference: `${item.sku || item.product_name || item.id}-${unitNumber}`,
        quantity,
        weightKg: Number(item.weight_kg ?? 0) * quantity,
        lengthMm: Number(item.length_mm ?? 0),
        widthMm: Number(item.width_mm ?? 0),
        heightMm: Number(item.height_mm ?? 0),
      });
      remaining = Math.max(0, remaining - quantity);
      unitNumber += 1;
    }
  }
  return {
    remainingQuantity,
    eligibility,
    hasAddress,
    ready: eligibility.eligible && hasAddress,
    suggestion: suggestParcels(units, presets),
  };
}

function aggregateAllocations(
  units: PackableUnit[],
): Array<{ soItemId: number; quantity: number }> {
  const quantities = new Map<number, number>();
  for (const unit of units)
    quantities.set(
      unit.soItemId,
      (quantities.get(unit.soItemId) ?? 0) + unit.quantity,
    );
  return [...quantities].map(([soItemId, quantity]) => ({
    soItemId,
    quantity,
  }));
}

function initialParcels(
  order: SalesOrderDetail,
  presets: PackingPreset[],
): EditableParcel[] {
  const plan = buildPackingPlan(order, presets);
  if (
    plan.suggestion.parcels.length > 0 &&
    plan.suggestion.unpacked.length === 0
  ) {
    return plan.suggestion.parcels.map((parcel) => ({
      packagePresetId: String(parcel.preset.id),
      packageType: parcel.preset.packageType,
      lengthMm: String(parcel.preset.lengthMm),
      widthMm: String(parcel.preset.widthMm),
      heightMm: String(parcel.preset.heightMm),
      weightKg: String(Number(parcel.weightKg.toFixed(3))),
      allocations: aggregateAllocations(parcel.units),
    }));
  }
  return [
    {
      packagePresetId: "",
      packageType: "custom",
      lengthMm: "",
      widthMm: "",
      heightMm: "",
      weightKg: "",
      allocations: remainingAllocations(order),
    },
  ];
}

function remainingAllocations(
  order: SalesOrderDetail,
  quantityMultiplier = 1,
): ParcelAllocation[] {
  return (order.items ?? []).map((item) => ({
    soItemId: Number(item.id),
    quantity:
      Math.max(0, Number(item.qty_ordered) - Number(item.qty_fulfilled)) *
      quantityMultiplier,
  }));
}

function formatChannelShippingMethod(order: SalesOrderSummary): string {
  const method = String(order.channel_shipping_method ?? "").trim();
  if (!method) return "";
  if (
    order.channel_delivery_type === "pickup" &&
    !/pickup|collect/i.test(method)
  )
    return `Pickup in store at ${method}`;
  return method;
}

function groupSavedShipments(shipments: SavedShippingShipment[]): Array<{
  batchId: string;
  shipments: SavedShippingShipment[];
}> {
  const batches = new Map<string, SavedShippingShipment[]>();
  for (const shipment of shipments) {
    const batchId = shipment.batchId || `shipment-${shipment.shipmentId}`;
    batches.set(batchId, [...(batches.get(batchId) ?? []), shipment]);
  }
  return [...batches].map(([batchId, batchShipments]) => ({
    batchId,
    shipments: batchShipments,
  }));
}

function batchStatusLabel(shipments: SavedShippingShipment[]): string {
  const statuses = new Set(shipments.map((shipment) => shipment.status));
  if (statuses.size === 1) return shippingStatusLabel(shipments[0].status);
  if (statuses.has("failed") || statuses.has("label_unknown"))
    return "Needs attention";
  if (statuses.has("label_pending") || statuses.has("label_submitting"))
    return "Waiting for labels";
  return "Preparation in progress";
}

function shippingStatusLabel(status: string): string {
  return (
    (
      {
        draft: "Prepared",
        carrier_created: "Postage created",
        label_submitting: "Creating labels",
        label_pending: "Label processing",
        label_unknown: "Label needs review",
        label_ready: "Ready to dispatch",
        failed: "Needs attention",
      } as Record<string, string>
    )[status] ?? status.replaceAll("_", " ")
  );
}

function manifestLabelButtonLabel(layout: string): string {
  if (layout === "A4-1pp") return "Print International labels";
  if (layout === "A4-3pp") return "Print Express labels";
  if (layout === "A4-4pp") return "Print Parcel labels";
  return `Print ${layout} labels`;
}

function labelDownloadButtonLabel(
  results: ShippingSubmissionResult[],
  services: Record<number, ShippingRate>,
  savedShipments: SavedShippingShipment[],
  orders: SalesOrderDetail[],
  index: number,
): string {
  const persistedShipments = results.map((result) =>
    savedShipments.find((shipment) => shipment.shipmentId === result.shipmentId),
  );
  if (results.length && results.every((result) => {
    const persisted = persistedShipments.find(
      (shipment) => shipment?.shipmentId === result.shipmentId,
    );
    const order = orders.find((item) => item.id === result.soId);
    return persisted?.isInternational === true || Boolean(order && isInternationalOrder(order));
  })) return "International labels";
  const serviceNames = results.map(
    (result) =>
      services[result.soId]?.serviceName ??
      savedShipments.find(
        (shipment) => shipment.shipmentId === result.shipmentId,
      )?.serviceName ??
      "",
  );
  if (
    serviceNames.length &&
    serviceNames.every((name) => /express/i.test(name))
  )
    return "Express labels";
  if (serviceNames.some(Boolean)) return "Parcel labels";
  return `Label PDF${index ? ` ${index + 1}` : ""}`;
}

function isInternationalOrder(order: Pick<SalesOrderSummary, "delivery_country">): boolean {
  const country = String(order.delivery_country ?? "").trim();
  return Boolean(country) && !isAustralianShippingCountry(country);
}

function destinationLabel(country: string | null | undefined, international?: boolean): string {
  const value = String(country ?? "").trim();
  if (!value) return "Destination country missing";
  let name = value;
  if (/^[A-Za-z]{2}$/.test(value)) {
    try {
      name = new Intl.DisplayNames(["en-AU"], { type: "region" }).of(value.toUpperCase()) ?? value.toUpperCase();
    } catch {
      name = value.toUpperCase();
    }
  }
  const isInternational = international ?? !isAustralianShippingCountry(value);
  return `${name} · ${isInternational ? "International" : "Domestic"}`;
}

function customsRowsForOrder(
  order: SalesOrderDetail,
  parcels: EditableParcel[],
  exportPurpose: ShippingExportPurpose,
  nonSaleValues: Record<number, string>,
) {
  return buildWorkspaceCustomsRows({
    lines: (order.items ?? []).map((item): WorkspaceCustomsLine => ({
      id: Number(item.id),
      productId: item.product_id ? String(item.product_id) : null,
      sku: String(item.sku ?? ""),
      productName: String(item.product_name ?? ""),
      customsDescription: item.customs_description ?? null,
      hsCode: item.hs_code ?? null,
      countryOfOrigin: item.country_of_origin ?? null,
      isDangerousOrRestricted: Boolean(item.is_dangerous_or_restricted),
      weightKg: item.weight_kg == null ? null : Number(item.weight_kg),
      unitPrice: Number(item.unit_price),
      discountPct: Number(item.discount_pct ?? 0),
      taxRate: Number(item.tax_rate ?? 0),
    })),
    allocations: parcels.flatMap((parcel) => parcel.allocations),
    exportPurpose,
    taxTreatment: order.tax_treatment ?? "ex_tax",
    nonSaleValues,
  });
}

function customsBlockersForOrder(
  order: SalesOrderDetail,
  parcels: EditableParcel[],
  exportPurpose: ShippingExportPurpose,
  nonSaleValues: Record<number, string>,
  nonSaleValuesConfirmed: boolean,
): string[] {
  if (!isInternationalOrder(order)) return [];
  return getWorkspaceCustomsBlockers({
    rows: customsRowsForOrder(order, parcels, exportPurpose, nonSaleValues),
    exportPurpose,
    nonSaleValuesConfirmed,
  });
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function shippingAddressReady(order: SalesOrderDetail): boolean {
  if (!order.delivery_address || !order.delivery_country) return false;
  if (isInternationalOrder(order)) {
    return Boolean(
      order.customer_name && (order.customer_email || order.customer_phone),
    );
  }
  return Boolean(
    order.delivery_suburb && order.delivery_state && order.delivery_postcode,
  );
}

function validEditableParcels(
  order: SalesOrderDetail,
  parcels: EditableParcel[] | undefined,
): boolean {
  return editableParcelIssue(order, parcels) === "";
}

function editableParcelIssue(
  order: SalesOrderDetail,
  parcels: EditableParcel[] | undefined,
): string {
  if (!parcels?.length) return "Add at least one parcel.";
  const invalidParcelIndex = parcels.findIndex(
    (parcel) =>
      ![
        parcel.lengthMm,
        parcel.widthMm,
        parcel.heightMm,
        parcel.weightKg,
      ].every((value) => Number.isFinite(Number(value)) && Number(value) > 0),
  );
  if (invalidParcelIndex >= 0)
    return `Enter positive dimensions and packed weight for parcel ${invalidParcelIndex + 1}.`;
  const emptyParcelIndex = parcels.findIndex(
    (parcel) =>
      !parcel.allocations.some((allocation) => allocation.quantity > 0),
  );
  if (emptyParcelIndex >= 0)
    return `Assign at least one item quantity to parcel ${emptyParcelIndex + 1}.`;
  if (
    parcels.some((parcel) =>
      parcel.allocations.some(
        (allocation) =>
          !Number.isFinite(allocation.quantity) || allocation.quantity < 0,
      ),
    )
  ) {
    return "Parcel item quantities cannot be negative.";
  }
  const incompleteItem = (order.items ?? []).find((item) => {
    const remaining = Math.max(
      0,
      Number(item.qty_ordered) - Number(item.qty_fulfilled),
    );
    const allocated = parcels.reduce(
      (sum, parcel) =>
        sum +
        (parcel.allocations.find((value) => value.soItemId === Number(item.id))
          ?.quantity ?? 0),
      0,
    );
    return Math.abs(remaining - allocated) >= 0.0001;
  });
  if (incompleteItem) {
    const remaining = Math.max(
      0,
      Number(incompleteItem.qty_ordered) - Number(incompleteItem.qty_fulfilled),
    );
    return `Assign exactly ${remaining} of ${incompleteItem.sku || incompleteItem.product_name || `item ${incompleteItem.id}`} across the parcels.`;
  }
  return "";
}

function formatAud(value: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(value);
}

function getChannelOrderNumber(order: SalesOrderDetail): string {
  return String(
    order.channel_order_number ??
      order.external_order_number ??
      order.shopify_order_name ??
      order.native_checkout_id ??
      "",
  ).trim();
}
