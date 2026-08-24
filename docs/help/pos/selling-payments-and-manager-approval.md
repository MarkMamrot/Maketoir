---
{"id":"pos-selling-payments-manager-approval","title":"Selling, Payments, and Manager Approval","audiences":["pos","ims"],"capability":"pos","screen":"POS Checkout and Parked Sales","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-returns-exchanges-customer-credit","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["pos","parked"],"contextSections":{"pos":"Step-by-step","parked":"Park and resume a sale"},"order":10,"summary":"Build a tax-inclusive sale, park it safely, take split tender, and respond to manager approval prompts.","lastReviewed":"2026-08-23","owner":"retail"}
---
# Selling, Payments, and Manager Approval

Use this guide to build and complete an ordinary sale, including verified split payments and protected follow-up actions.

## Main operations

- Search, scan, or browse for the correct product variant.
- Adjust quantities, prices, item discounts, or the order discount before payment.
- Find and link an active retail customer by name or phone when using store credit or loyalty.
- Park an unfinished cart on this device and resume it later.
- Add more than one tender when the customer splits payment.
- Ask a manager to authorise an action only when POS displays the manager PIN prompt.

## At a glance

| Checkout item | Current behaviour |
|---|---|
| Prices | Tax-inclusive; the displayed **GST (incl.)** is extracted from the total |
| Stock | A completed stock-item sale reduces stock at the active POS location |
| Split tender | Add payment lines until **Remaining** is zero |
| Cash | The remaining balance is rounded to the nearest 5 cents and change is shown |
| Parked sale | Saved in this browser and removed from Parked Sales when resumed |
| Zero total | Completes as a No Charge sale after discounts reduce the total to $0.00 |
| Today's Mission | Shows the location's current sales progress beside the location avatars, away from Charge and payment controls |

## Before you begin

- [ ] Confirm the header shows the correct location and register.
- [ ] Confirm the register is open.
- [ ] Check the online and queue indicators.
- [ ] Identify the exact size, colour, or other variant before adding it.
- [ ] Link the customer before selecting store credit or loyalty.

> **Note:** There is no documented discount percentage that automatically triggers manager approval. Apply the business's discount policy, and use the manager PIN whenever POS explicitly asks for it.

## Step-by-step

1. Scan a barcode or search by product name, SKU, or barcode.
2. Add the correct variant and set the quantity.
3. Apply any permitted line discount, price change, or order discount before payment.
4. Open **Customer** and type at least two characters of the customer's name or phone number. Choose the active retail customer from the narrowing results when the sale uses store credit or a loyalty reward.
5. Check the tax-inclusive total and the **GST (incl.)** amount.
6. Choose **Charge** and choose a payment method.
7. For split tender, enter the first amount and choose **Add**, then choose the next method and add the remaining amount.
8. Complete the sale only when **Remaining** is zero. Print or provide the receipt as required.

## Park and resume a sale

1. With products in the cart, choose **Park current sale**.
2. Enter a useful label, such as the customer's name, or accept the time-based label.
3. Open **Parked Sales** from the POS menu.
4. Choose the saved cart to retrieve it. Retrieval removes that entry from Parked Sales.
5. Recheck the cart, customer, price, stock, and payment before charging.

Parked carts are stored on that browser. They are not completed sales and do not reduce stock until checkout finishes.

## Manager approval

| Action | Manager PIN behaviour |
|---|---|
| Edit a transaction from the current open register session | Required |
| Delete or void a transaction from the current open register session | Required |
| Send a branch transfer when POS transfer access is set to Manager | Required |
| Ordinary cart discount or price edit | Follow local policy; POS does not document a universal approval threshold |
| Change POS appearance or terminal settings | Available only to POS Manager, Standard User, Admin, or SuperAdmin roles |

> **Warning:** A manager should enter their own location manager PIN at the prompt. Do not disclose it to the cashier or leave it written at the till.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Charge is disabled | The cart is empty or the register is confirmed closed | Add an item or open the register |
| Split payment cannot complete | The payment lines do not equal the amount due | Check **Remaining**, correct or remove a line, and add the exact balance |
| Store Credit is missing from payment choices | No eligible customer is linked or the balance is zero | Link the correct customer and confirm their available balance |
| Customer search has no matches | No active Retail Customer matches the entered name or phone | Check the details or maintain the contact as an active Retail Customer in IMS |
| A parked sale is missing on another device | Parked carts are local to the browser that saved them | Return to the original device and resume it there |
| A protected action cannot continue | The manager PIN is unavailable or incorrect | Cancel the action and ask an authorised manager to approve it |

## Worked examples

### Split a $149.95 sale between gift card and card

Verify the customer's gift card and add $50.00 as the first payment. **Remaining** becomes $99.95. Choose Card and add $99.95. POS completes the sale only after the two payment lines total $149.95, and the receipt records both tenders.

### Read GST correctly

A jacket is displayed at $110.00. That price already includes $10.00 GST. The customer pays $110.00, not $121.00.

## Related tasks

See **Returns, Exchanges, and Customer Credit** for negative carts and **Settings, Terminals, and Offline Recovery** for payment-terminal or queue failures.