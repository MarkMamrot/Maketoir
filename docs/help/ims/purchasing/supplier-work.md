---
{"id":"ims-supplier-work","title":"Planning, Backorders, and Supplier Credits","audiences":["ims"],"capability":"orders","screen":"Purchasing","product":"ims","parentId":"ims-purchasing","contexts":["order-planner","supplier-backorders","supplier-credit-notes"],"contextSections":{"order-planner":"Order planner","supplier-backorders":"Supplier backorders","supplier-credit-notes":"Supplier credit notes"},"order":11,"summary":"Turn replenishment signals into reviewed purchasing work and resolve supplier-side exceptions.","lastReviewed":"2026-08-23","owner":"inventory"}
---
# Planning, Backorders, and Supplier Credits

## Main operations

- Review demand, stock, incoming supply, supplier, location, and forecast assumptions in Order Planner.
- Create purchasing work only after checking proposed quantities and dates.
- Continue receiving genuine later deliveries from Supplier Backorders.
- Record supplier returns and credits through Supplier Credit Notes.

## Order planner

Order Planner provides replenishment suggestions from available demand and supply signals. Suggestions are decision support, not proof that the quantity should be ordered. Review current stock, committed demand, incoming supply, supplier selection, lead time, location, and forecast window before creating a Purchase Order.

## Supplier backorders

Supplier Backorders shows quantities not received with the original delivery. Keep the balance open when the supplier will deliver later. If the balance is cancelled, transferred, or otherwise resolved, use the supported resolution action so the original receipt history remains intact.

## Supplier credit notes

Supplier Credit Notes records returns to a supplier and the related credit. Use completion and correction actions offered by the document so stock, supplier value, evidence, and any Xero posting remain linked. Do not use a generic negative receipt to imitate a completed supplier return.

## Troubleshooting

- If a suggestion seems excessive, inspect the planning window, committed demand, incoming supply, and selected location.
- If a backorder is missing, check the original PO receipt and whether the outstanding balance was resolved.
- If a supplier credit cannot be changed, inspect lifecycle state and existing stock or accounting effects.

## Worked examples

### Review a replenishment suggestion

Select the location and supplier in Order Planner, inspect current and incoming stock, compare the demand window, and adjust only where the operational evidence supports it. Review the resulting Purchase Order before confirmation.

### Record stock returned to a supplier

Create or open the Supplier Credit Note, select the supplier and eligible products, enter quantities physically returned, attach the available evidence, and complete through the offered action. Review integration status separately if Xero posting is enabled.