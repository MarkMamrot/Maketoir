---
{"id":"pos-selling-payments-manager-approval","title":"Selling, Payments, and Manager Approval","audiences":["pos","ims"],"capability":"pos","screen":"POS Checkout and Parked Sales","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-customers","pos-loyalty-rewards","pos-gift-cards","pos-store-credit","pos-returns-exchanges-customer-credit","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["pos","parked"],"contextSections":{"pos":"Step-by-step","parked":"Park and resume a sale"},"order":10,"summary":"Build a tax-inclusive sale, park safely, take split tender, and respond to manager approval prompts.","lastReviewed":"2026-08-31","owner":"retail"}
---
# Selling, Payments, and Manager Approval

Use this guide to build and complete an ordinary sale, including verified split payments and protected follow-up actions.

## Main operations

- Search, scan, or browse for the correct product variant.
- Adjust quantities, prices, item discounts, or the order discount before payment.
- Find, create, or reactivate and link a retail customer when using store credit or loyalty.
- Park an unfinished cart on this device and resume it later.
- Add more than one tender when the customer splits payment.
- Ask a manager to authorise an action only when POS displays the manager PIN prompt.

## At a glance

| Checkout item | Current behaviour |
|---|---|
| Prices | Tax-inclusive; the displayed **GST (incl.)** is extracted from the total |
| Stock | A completed tracked-product sale reduces stock at the active POS location; untracked products sell without a quantity check or stock movement |
| Product display | **Variants** shows every variant separately; **Products** groups variants and asks which one to add |
| Split tender | Add payment lines until **Remaining** is zero |
| Cash | The remaining balance is rounded to the nearest 5 cents and change is shown |
| Parked sale | Saved in this browser and removed from Parked Sales when resumed |
| Zero total | Completes as a No Charge sale after discounts reduce the total to $0.00 |
| Today's Mission | Shows the location's current sales progress beside Team Communications, away from Charge and payment controls |
| Team Communications | Contains the available branch and Warehouse avatars; open Team Chat from the top toolbar, or select an avatar to send that location a direct message |
| Help and Ask Solvantis | Open both from the Help button in the top toolbar |
| Training Mode | Prints a clearly marked training receipt without changing live sales, stock, customer value, EOD, reports, or accounting |

Paste a JPG, PNG, or WebP screenshot directly into the Team Chat or direct-message box before sending. A message can include up to three attachments of 10 MB each.

## Before you begin

- [ ] Confirm the header shows the correct location and register.
- [ ] Confirm the register is open.
- [ ] Check the online and queue indicators.
- [ ] Identify the exact size, colour, or other variant before adding it.
- [ ] Link the customer before selecting store credit or loyalty.

> **Note:** There is no documented discount percentage that automatically triggers manager approval. Apply the business's discount policy, and use the manager PIN whenever POS explicitly asks for it.

## Step-by-step

1. Ask an authorised manager to choose **Variants** or **Products** under **POS Settings > Misc > Product display**. Variants shows each variant separately; Products shows one result for each product. The choice is remembered by this POS device.
2. Scan a barcode or search by product name, SKU, or barcode. Scanning any variant barcode adds that exact variant, even in Products mode.
3. In Products mode, select a product and then choose the correct size, colour, or other variant. Use its **i** button to see every variant's stock at each location.
4. Add the correct variant and set the quantity.
5. Apply any permitted line discount, price change, or order discount before payment.
6. Open **Customer** and use the single search field to type at least two characters of the customer's name, phone number, or email address. Choose the active customer from the narrowing results when the sale uses store credit or a loyalty reward. When matching inactive customers exist, choose **Show** and select the customer marked **Inactive** to reactivate and link them directly. Reactivation keeps the customer's existing details, store credit, and loyalty balance.
7. If the customer does not exist, choose **New**. Enter their first name and at least an email address or phone number; last name is optional. Tick the loyalty option only after the customer agrees to join under the displayed terms, then choose **Create & link**. Loyalty enrolment is separate from marketing consent.
8. Check the tax-inclusive total and the **GST (incl.)** amount.
9. Choose **Charge** and choose a payment method.
10. For split tender, enter the first amount and choose **Add**, then choose the next method and add the remaining amount.
11. Complete the sale only when **Remaining** is zero. Print or provide the receipt as required.

When **Allow sales from incoming transfers** is enabled, a sale can take location stock below zero only up to the outstanding quantity of the same variant on Sent or Partially Received transfers to that location. POS shows an incoming-stock warning and creates an IMS notification for warehouse review. The normal transfer receipt then adds the arriving quantity against the negative balance.

Products with **Tracks Inventory** off can be sold in any whole quantity at any POS location. They do not reduce on-hand stock, create a stock warning, or use incoming transfer quantities.

When the POS header shows **TRAINING MODE**, the payment is simulated and the receipt is marked **TRAINING**. Do not treat it as a real payment or customer receipt. Switch Training Mode off in **POS Settings > Misc** before normal trading.

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
| Reactivate an inactive customer from customer search | Not required |
| Ordinary cart discount or price edit | Follow local policy; POS does not document a universal approval threshold |
| Change POS appearance or terminal settings | Available only to POS Manager, Standard User, Admin, or SuperAdmin roles |

> **Warning:** A manager should enter their own location manager PIN at the prompt. Do not disclose it to the cashier or leave it written at the till.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Charge is disabled | The cart is empty or the register is confirmed closed | Add an item or open the register |
| Split payment cannot complete | The payment lines do not equal the amount due | Check **Remaining**, correct or remove a line, and add the exact balance |
| Store Credit is missing from payment choices | No eligible customer is linked or the balance is zero | Link the correct customer and confirm their available balance |
| Customer search has no matches | No active retail or business customer matches the entered name, email, or phone | Check the details, choose **Show** for inactive matches, or choose **New** to create and link a customer |
| New customer cannot be created | The email or phone already belongs to an active or inactive customer, required details are missing, or the connection is offline | Search for the existing customer, enter a first name plus email or phone, and retry while online |
| Customer search is unavailable | POS could not reach the customer search service | Check the connection and retry; if it continues, ask an administrator to review Runtime Issues |
| Selecting a product does not add it immediately | **Products** mode is active and the product has multiple variants | Choose the correct variant from the picker; use **Variants** mode when separate results are faster |
| Sale says incoming transfer stock was used | Recorded stock was insufficient but a matching transfer is still awaiting receipt | Complete the matching transfer receipt and verify the location quantity; do not create another stock adjustment |
| A parked sale is missing on another device | Parked carts are local to the browser that saved them | Return to the original device and resume it there |
| A protected action cannot continue | The manager PIN is unavailable or incorrect | Cancel the action and ask an authorised manager to approve it |

## Worked examples

### Split a $149.95 sale between gift card and card

Verify the customer's gift card and add $50.00 as the first payment. **Remaining** becomes $99.95. Choose Card and add $99.95. POS completes the sale only after the two payment lines total $149.95, and the receipt records both tenders.

### Read GST correctly

A jacket is displayed at $110.00. That price already includes $10.00 GST. The customer pays $110.00, not $121.00.

## Related tasks

See **Customers at POS**, **Loyalty Rewards at POS**, **Gift Cards at POS**, and **Store Credit at POS** for customer-value procedures. See **Returns, Exchanges, and Customer Credit** for negative carts and **Settings, Terminals, and Offline Recovery** for payment-terminal or queue failures.