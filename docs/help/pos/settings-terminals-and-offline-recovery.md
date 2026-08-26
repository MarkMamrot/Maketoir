---
{"id":"pos-settings-terminals-offline-recovery","title":"Settings, Terminals, and Offline Recovery","audiences":["pos","ims"],"capability":"pos","screen":"POS Settings and Offline Queue","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-selling-payments-manager-approval","pos-end-of-day-xero"],"contexts":["pos","reports","parked"],"order":50,"summary":"Manage permitted POS settings, pair Zeller, understand offline limits, and recover queued sales safely.","lastReviewed":"2026-08-26","owner":"retail"}
---
# Settings, Terminals, and Offline Recovery

Use this guide to change permitted POS presentation and device settings, use Training Mode, operate a paired Zeller terminal, and recover sales saved on the device during a connection failure.

## Main operations

- Open POS Settings with a permitted staff role.
- Choose whether this device groups the catalogue by product or shows every variant, whether it defaults to in-stock products, and where its cart appears.
- Turn Training Mode on or off for the current POS device.
- Pair or re-pair the configured Zeller terminal and control whether it is active for the current session.
- Continue supported ordinary sales from cached products while offline.
- Inspect queued and failed sales, retry them, and confirm they reached Reports.
- Stop online-only workflows until connectivity returns.

## At a glance

| Workflow | Works offline? | What happens |
|---|---|---|
| Browse cached products and build a cart | Yes | Cached names, prices, and stock are shown; stale data is flagged |
| Complete an ordinary sale with a manual tender | Yes | The sale is saved in this device's queue for later upload |
| Park or resume a cart on this device | Yes | The cart remains in this browser only |
| Linked return | No | The original sale and credit-note flow require the server |
| Loyalty balance or reward | No | Current balance and redemption must be validated online |
| Gift-card verification or store-credit lookup | No | Current value cannot be safely confirmed offline |
| Zeller terminal payment | No | The browser and terminal both need working internet |
| Petty cash | No | The register entry and receipt upload require an open online session |
| Branch transfer, Reports, register open/close, or End of Day | No | These workflows require current shared records |
| Ask Solvantis | No | Assistant questions are not queued |
| Complete a Training Mode sale | No | A separate training audit is recorded online; no live sale, stock, customer value, EOD, report, or accounting record is created |
| Reprint a receipt from Reports | No | One print request is allowed from each receipt preview; close and reopen the receipt for a deliberate additional copy |

## Before you begin

- [ ] Confirm this browser has previously signed in and cached products before relying on offline mode.
- [ ] Check whether the product-cache warning says prices may be out of date.
- [ ] Know which card methods are configured to route to Zeller.
- [ ] Keep the browser and device storage intact until every queued sale is resolved.
- [ ] Use **Discard** only when a queued sale definitely never happened or was already recorded another way.

> **Important:** A queued sale is the record of a real checkout. Never enter it again merely because it is not yet visible in Reports; first reconnect, sync, and inspect the queue.

## Step-by-step

### Set the catalogue and cart defaults

1. A POS Manager, Standard User, Admin, or SuperAdmin opens **POS Settings**.
2. Open **Misc**.
3. Under **Product display**, choose **Products** to group variants and ask for the exact variant when a product is selected, or **Variants** to show every variant separately. Scanning a barcode still adds that exact variant in either mode.
4. Turn **Default to In Stock** on to hide unavailable products in the normal catalogue, or off to show all products by default.
5. Choose **Left side** or **Right side** under **Cart position**.
6. Close POS Settings when finished. These choices apply immediately and are remembered by this POS device.

The **In Stock** button beside search remains available during selling. Selecting it changes the current filter and the remembered default for this device.

### Practise with Training Mode

1. A POS Manager, Standard User, Admin, or SuperAdmin opens **POS Settings**.
2. Open **Misc** and switch on **Training Mode**. The setting applies only to the current browser and register.
3. Confirm the amber **TRAINING MODE** marker remains visible in the POS header.
4. Build an ordinary positive-quantity sale and use a simulated configured tender. Training Mode does not contact a live card terminal.
5. Complete the sale and print the receipt. The receipt is marked **TRAINING** and must not be given as proof of a real payment.
6. Return to **POS Settings > Misc** and switch Training Mode off before serving customers.

Training Mode does not create a live sale or affect inventory, Reports, End of Day, Xero, loyalty, gift cards, or store credit. Returns, laybys, loyalty rewards, gift cards, store credit, and offline completion are unavailable while it is active.

### Pair or recover Zeller

1. A POS Manager, Standard User, Admin, or SuperAdmin opens **POS Settings**.
2. Confirm the active register is configured for Zeller.
3. Select **Pair / Re-pair Terminal** and sign in to the correct Zeller account.
4. Select the terminal and complete pairing. Pairing persists across sessions.
5. Leave **Terminal active this session** on when configured card methods should route to Zeller.
6. At payment, wait for terminal approval. Use **manual entry instead** only when the business has separately completed or authorised the payment.

### Recover queued sales

1. Keep the same browser open and restore connectivity.
2. If POS says queued sales have no open register session, open the register first so recent sales can link to it. If you upload without doing so, End of Day expected totals may omit them.
3. Select **Sync** and wait for the queued count to fall.
4. Open the queue panel to inspect anything still queued or marked Failed.
5. Select the failed-sales retry action after correcting the connection or validation problem.
6. Confirm each sale appears once in **Reports** before discarding any local entry.

### Reprint an old receipt

1. Open **Reports**, find the completed transaction, and select **Print**.
2. In the browser print dialog, confirm **Copies** is `1` and the intended receipt printer is selected.
3. Print once. The receipt preview prevents another request from that same normal-receipt view.
4. To deliberately print another copy, close the preview, reopen the transaction's receipt, and print again.

The browser controls its copy count and the Windows printer queue. Solvantis cannot override a saved multi-copy setting in Chrome or cancel duplicate jobs already held by the printer.

## Settings and recovery decisions

| Situation | Safe action |
|---|---|
| Zeller says Setup Required | Open Settings and pair the terminal |
| Zeller terminal is paired but unavailable | Check power, internet, and Integrated Payments mode on the terminal |
| Payment completed outside the integration | Use manual entry only after independently confirming the approved payment |
| Product cache is stale | Verify prices with the customer and sync as soon as possible |
| A queued sale reaches repeated failures | Inspect its error, correct the cause, then retry from the failed queue |
| You are unsure whether a queued sale happened | Check the payment evidence and Reports; do not discard or duplicate it |

> **Note:** Zeller connects through its cloud service. The POS device and terminal both require internet access; being on the same local network is not the deciding factor.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| POS Settings cannot be opened | The signed-in tier does not have settings access | Ask a POS Manager, Standard User, Admin, or SuperAdmin |
| Training sale cannot complete | The device is offline or the cart uses a restricted workflow | Reconnect and use an ordinary sale without returns, laybys, rewards, gift cards, or store credit |
| Terminal payment cannot start | Pairing, terminal availability, or internet is missing | Check the exact terminal message, then pair or reconnect |
| Queued count does not clear | Upload is failing or the register/session needs attention | Open the queue panel, read the error, correct it, and retry |
| A sale is in Failed | It reached the retry limit but remains saved locally | Correct the cause and use the failed-sales retry action |
| Offline POS has no products | This browser has no usable cached catalogue | Reconnect and sign in to refresh products before trading |
| One reprint produces several physical copies | Chrome has remembered a copy count above 1, or Windows/printer firmware duplicated one submitted job | Set **Copies** to `1`, cancel the printer queue, and restart Chrome and the printer before retrying one receipt |

## Worked examples

### Recover three sales after an outage

The shop takes three ordinary manual-card sales while offline. When the connection returns, POS warns that the register is not open. Staff open the register, let the three queued sales upload, and confirm all three appear once in Reports. They then complete End of Day using the updated expected amount.

## Related tasks

See **Register, Device, and Login** for register sessions, **Selling, Payments, and Manager Approval** for checkout, and **End of Day and Xero** for reconciliation.