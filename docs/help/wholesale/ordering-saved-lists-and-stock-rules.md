---
{"id":"wholesale-ordering-saved-lists-stock-rules","title":"Ordering, Saved Lists, and Stock Rules","audiences":["wholesale"],"capability":"wholesale","screen":"Wholesale Catalogue, Saved Lists, and Orders","product":"wholesale","format":"task","parentId":"wholesale-portal","relatedTopics":["wholesale-getting-started-account-approval","wholesale-team-locations-permissions"],"contexts":["catalogue","lists","orders"],"contextSections":{"catalogue":"Step-by-step","lists":"Saved lists and favourites","orders":"Drafts, submitted orders, and reordering"},"order":20,"summary":"Order from the approved catalogue, reuse saved lists, and understand live stock, current prices, and indent quantities.","lastReviewed":"2026-08-23","owner":"wholesale"}
---
# Ordering, Saved Lists, and Stock Rules

Use this guide to prepare, save, submit, and repeat wholesale orders using the catalogue and rules currently approved for your account.

## Main operations

- Browse products and brands in the approved catalogue.
- Order whole quantities and follow the displayed pack rule where configured.
- Use indent only on products the supplier has enabled for it.
- Save drafts, shared saved lists, and private favourites.
- Reload a draft or prior order at current price and availability.
- Review submitted order progress and available sales documents.

## At a glance

| Tool | What it remembers | What is refreshed when loaded |
|---|---|---|
| Cart | Current browser's products and quantities for the active account and location | Submission validates products, prices, access, and stock again |
| Draft | Editable order lines, notes, company, member, and buying location | Current catalogue, price, stock, and indent rules when reopened |
| Saved list | Stable product variants and desired whole quantities | Current name, SKU, price, stock, brand access, and indent rule |
| Favourite | A private shortcut for the signed-in member | Current product detail and orderability |
| Order again | Quantities from a submitted order | Current catalogue identity, price, stock, and indent rule |

## Before you begin

- [ ] Confirm the active buying location in the header.
- [ ] Clear search, brand, category, and availability filters if expected items are hidden.
- [ ] Check the variant, pack size, current wholesale price, and available quantity.
- [ ] Confirm any line labelled **Indent** is acceptable for the required delivery timing.
- [ ] Review the shipping address and payment terms before submission.

> **Important:** A saved list is a reusable quantity template, not a price or stock snapshot. Current catalogue rules always win when the list is loaded.

## Step-by-step

1. Open **Catalogue** and search or filter the approved range.
2. Choose the exact variant and enter a valid whole-unit or pack quantity.
3. Add the item. If the quantity exceeds available stock and indent is allowed, the cart labels the excess as indent.
4. Open the cart and review the buying location, delivery address, quantities, indent units, current prices, tax, and total.
5. Add an order note when useful.
6. Select **Save Draft** to continue later, or submit the order.
7. After submission, open **Orders** and confirm the new order reference and status.

## Saved lists and favourites

Saved lists are shared across the company. Any member can create one; its creator can delete it, and Owners or Admins can manage all company lists. Favourites are private to the individual member.

When a list loads, a non-indent line is reduced to current available stock. A retired, unapproved, or unavailable non-indent line is omitted. The portal reports adjusted and unavailable line counts so you can review the cart before proceeding.

## Drafts, submitted orders, and reordering

| Order view | Meaning | Available action |
|---|---|---|
| Drafts | Editable carts saved for a particular company, member, and buying location | Continue, replace the current cart after confirmation, or delete |
| Open | Submitted sales orders not yet fulfilled or cancelled | View products, quantities, fulfilment progress, dates, terms, and documents |
| Completed | Fulfilled or cancelled sales orders | Review history and order again using current rules |

Drafts for another assigned buying location are read-only until you switch to that location. **Order again** replaces a non-empty cart only after confirmation and never copies internal supplier notes.

## Stock and indent decisions

**Indent** means the supplier has approved that product for pre-order beyond current available stock. It is not a promise that every out-of-stock product can be ordered.

| Current rule | Requested quantity | Cart result |
|---|---:|---|
| 10 available, indent off | 14 | Reduced to 10 |
| 0 available, indent off | 4 | Line omitted |
| 10 available, indent on | 14 | 14 ordered: 10 available and 4 on indent |
| Variant retired or brand no longer approved | Any | Line omitted |

> **Warning:** Stock and access are checked again at submission. If availability changed after the cart was prepared, submission can stop and ask you to correct an overstock non-indent line.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A product or brand is absent | It is outside the account's current approved catalogue | Clear filters, then contact the supplier if approval should change |
| Saved list loads fewer units | A non-indent item has less available stock now | Review the reduced quantity and adjust the order |
| Saved list or reorder omits a line | The variant is retired, unapproved, or out of stock without indent | Choose an alternative or ask the supplier about availability |
| Draft opens as read-only | It belongs to another assigned buying location or a preview session | Switch to that location, or leave preview |
| Submission reports overstock | Live stock fell and indent is not enabled | Reduce the line to available stock or remove it |

## Worked examples

### Load a seasonal saved list

The "Winter window" list asks for 12 navy scarves at the old $18 price and 6 red beanies. Today the scarf price is $19.50 and only 8 are available without indent; the beanie variant is retired. Loading the list creates a cart with 8 scarves at $19.50 and omits the beanies. The buyer reviews the adjustment message before submitting.

### Use an approved indent quantity

A jacket has 5 available and its product allows indent. The buyer orders 9. The cart shows 4 units on indent, preserving the requested quantity because the supplier has enabled pre-ordering for that product.

## Related tasks

See **Team, Locations, and Permissions** before ordering for another branch, and **Getting Started and Account Approval** when access or catalogue approval is missing.