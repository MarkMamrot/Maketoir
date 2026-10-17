---
{"id":"pos-register-device-login","title":"Register, Device, and Login","audiences":["pos","ims"],"capability":"pos","screen":"POS Device Setup and Login","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-settings-terminals-offline-recovery","pos-end-of-day"],"contexts":["pos-register","pos-catalogue"],"contextSections":{"pos-register":"Step-by-step","pos-catalogue":"Saved products and catalogue updates"},"order":5,"summary":"Assign a POS device to a branch and register, sign in, open the register with a counted float, and understand saved-catalogue freshness notices.","lastReviewed":"2026-10-17","owner":"retail","quickSections":["Main operations","At a glance"],"navigation":{"category":"pos","label":"Set up a register and start the day","subgroup":"Start & end of day"}}
---
# Register, Device, and Login

Use this guide to bind a POS device to the correct branch and register, sign in as the operator, and open the till for trade.

## Main operations

- Set up the device once with a location code, or use an existing Admin session to select a branch.
- Select an active register for that branch.
- Sign in with the cashier username and PIN, or use the Admin sign-in option.
- Count and save the opening float before taking sales.
- Resolve a register session that was left open.
- Ask the Assistant whether the verified register is open and for its current shared takings summary.

## At a glance

| Stage | What it controls | Who or what you need |
|---|---|---|
| Device setup | The branch and register attached to this browser | Location code, or an authenticated Admin session |
| Operator sign-in | The staff identity recorded on POS work | Cashier username and PIN, or Admin credentials |
| Open Register | The register session and starting cash | A physical count of the opening float |
| Register Left Open | Whether to continue or close an existing session | Knowledge of the actual trading shift |

## Before you begin

- [ ] Confirm the physical device belongs at the branch you are selecting.
- [ ] Ask a manager for the location code if the device is not already set up.
- [ ] Confirm an active register exists for the location.
- [ ] Have the opening cash ready to count.
- [ ] Use your own operator identity; do not share a cashier or manager PIN.

> **Important:** Changing **Branch / Register** changes where later sales and register activity are recorded. Stop if the displayed branch or till does not match the physical device.

## Step-by-step

### Set up the device

1. On **POS - Device Setup**, enter the location code supplied by a manager. If you are already signed in as an Admin, select the branch instead.
2. Select **Next** and choose an active **Register / Till**.
3. Select **Set Up Device**.
4. Check the branch and register names shown on the login screen.

If the location has no active registers, setup explains that a register is required and provides **Open Locations in IMS**. In IMS, select the location and choose **Add Register**, then return to POS setup.

The Assistant can check the register assigned to the signed-in POS session. It reports whether that verified register has an open session and, while open, its session date, opening float, sale and return counts, tax-inclusive sales, extracted GST, expected payment-method takings, petty cash, and whether End of Day counts have been saved. It does not reveal operator or customer identities.

### Sign in and open the register

1. Enter your POS username and PIN, then select **Sign In**. Admins can use **Admin login** instead.
2. If **Register Left Open** appears, choose **Continue Session** only when work genuinely belongs to that same session. Otherwise select **Close Register (Enter Counts)**.
3. Open **Register**, select **Open Register**, and count the opening cash by denomination.
4. Compare **Counted Float** with **Expected Float**, resolve any unexplained difference, and save.
5. Return to POS and confirm the Charge action is available.

## Saved products and catalogue updates

Use a current Chrome, Edge, Firefox or Safari browser. If POS asks for a browser update, keep the freshness warning in view and ask a manager to update the browser before relying on saved prices or stock.

On a device with saved products, signing in can open POS using its saved catalogue while current prices and stock refresh in the background. A visible notice explains when saved prices and stock may be out of date. You may continue ordinary supported sales, but verify prices while that notice remains. An item already added to a cart keeps its recorded price; a later catalogue update does not silently reprice the cart or parked sales.

If the update fails, the notice remains and asks you to keep POS online and try **Sync**. A successful refresh updates newly selected items. A device without a usable saved catalogue must finish its initial catalogue download before product selling opens.

Where incremental catalogue refresh is enabled, ordinary sign-in and background refreshes download changed products rather than rebuilding the entire catalogue. New products, corrected names and barcodes, promotion changes, stock changes and removed products are included.

Full rebuilds remain available through **Sync**. An automatic rebuild becomes due at least one calendar month after the last successful rebuild, with a random delay of up to two hours from the first authenticated POS opening when due. The delay is remembered across reloads. Only one full rebuild runs at a time for the business, so another register's rebuild can delay the start. Offline, sleeping or closed devices resume pending maintenance when available; they cannot update while closed.

## Login and register decisions

| Situation | Correct action |
|---|---|
| The device shows the wrong branch or register | Select **Change Branch / Register** and set it up again before trading |
| Today's session is already open | Continue it; do not open a second session for the same register |
| A session from a previous day is still open | Close it through End of Day, then open a fresh session for today |
| The register is confirmed closed | Open it and count the actual float before the first sale |
| The device starts offline with saved session and product data | Ordinary sales can open in recovery mode; verify the register as soon as connectivity returns |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Location code is not recognised | The code is wrong, expired, or belongs to another branch | Re-enter it exactly or ask the manager to confirm the code in IMS |
| No registers are listed | The branch has no active register | Select **Open Locations in IMS**, choose the location, then add or reactivate a register before setup |
| Products are missing after signing into a different business in the same browser | The saved POS device or session belongs to the previously used business | POS clears the stale session and returns to Device Setup; select a branch and register for the currently signed-in business |
| Username or PIN fails | The details do not match an active POS user at this location | Check the username and ask a manager to review access; do not use another person's PIN |
| Browser storage or product-cache warning appears during sign-in | The browser could not retain the refreshed catalogue for offline recovery | Sign-in can continue using the available catalogue while online. Do not clear browser data while queued or failed sales exist; ask a manager to review the offline queue and device storage first |
| POS stays on Loading after its product cache was cleared | The full catalogue is rebuilding into persistent device storage before the scanner opens | Keep the device online and wait for the login screen or POS to appear; do not repeatedly refresh during the rebuild |
| Register not open blocks Charge | No open session was confirmed for this register | Open **Register** and save the opening float |
| A prior-day session warning appears | The till was not closed on its trading day | Count and close that session before opening today's session |

## Worked examples

### Move a replacement tablet to the Melbourne register

The manager enters Melbourne's location code, selects **Front Till**, and completes setup. Alex signs in with their own username and PIN, counts $200 in the drawer, and opens the register with a $200 float. The header now shows Melbourne and Front Till before the first sale is charged.

## Related tasks

See **Selling, Payments, and Manager Approval** for checkout and **End of Day and Register Close** for closing the session.