export function ConsignmentNotice({ compact = false }: { compact?: boolean }) {
  return compact ? <span style={{ marginLeft: 8, color: '#b45309', fontWeight: 600 }}>Consignment</span>
    : <p role="note" style={{ padding: 12, border: '1px solid var(--sv-etch)', borderRadius: 8 }}>
      <strong>Consignment · stock-only</strong> — Receiving or returning this stock does not create a supplier invoice, payment or Xero bill/credit. Keep supplier settlement and payment separate. Internal stock costs remain available; consignment is excluded from owned inventory value.
    </p>;
}
