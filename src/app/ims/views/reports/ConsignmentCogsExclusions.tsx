export function ConsignmentCogsExclusions({ calculation }: {
  calculation: { excludedConsignmentCOGS?: number; excludedConsignmentQuantity?: number; excludedConsignmentMovementCount?: number };
}) {
  return <p role="note" style={{ margin: '8px 0', fontSize: 12, color: 'var(--sv-text-dim)' }}>
    <strong>Intentionally excluded from Xero COGS — consignment:</strong>{' '}
    {Number(calculation.excludedConsignmentCOGS ?? 0).toLocaleString('en-AU', { style: 'currency', currency: 'AUD' })}
    {' · '}{calculation.excludedConsignmentQuantity ?? 0} units
    {' · '}{calculation.excludedConsignmentMovementCount ?? 0} movements.
    {' '}Internal cost and margin evidence is retained; this is not a missing-cost or posting gap.
  </p>;
}
