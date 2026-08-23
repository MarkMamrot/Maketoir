---
{"id":"pos-register-device-login","title":"Register, Device, and Login","audiences":["pos","ims"],"capability":"pos","screen":"POS Device Setup and Login","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-selling-payments-manager-approval","pos-settings-terminals-offline-recovery","pos-end-of-day-xero"],"contexts":["pos","reports","parked"],"order":5,"summary":"Assign a POS device to a branch and register, sign in, and open the register with a counted float.","lastReviewed":"2026-08-23","owner":"retail"}
---
# Register, Device, and Login

Use this guide to bind a POS device to the correct branch and register, sign in as the operator, and open the till for trade.

## Main operations

- Set up the device once with a location code, or use an existing Admin session to select a branch.
- Select an active register for that branch.
- Sign in with the cashier username and PIN, or use the Admin sign-in option.
- Count and save the opening float before taking sales.
- Resolve a register session that was left open.

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

### Sign in and open the register

1. Enter your POS username and PIN, then select **Sign In**. Admins can use **Admin login** instead.
2. If **Register Left Open** appears, choose **Continue Session** only when work genuinely belongs to that same session. Otherwise select **Close Register (Enter Counts)**.
3. Open **Register**, select **Open Register**, and count the opening cash by denomination.
4. Compare **Counted Float** with **Expected Float**, resolve any unexplained difference, and save.
5. Return to POS and confirm the Charge action is available.

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
| No registers are listed | The branch has no active register | Ask a manager to add or reactivate the register before setup |
| Username or PIN fails | The details do not match an active POS user at this location | Check the username and ask a manager to review access; do not use another person's PIN |
| Register not open blocks Charge | No open session was confirmed for this register | Open **Register** and save the opening float |
| A prior-day session warning appears | The till was not closed on its trading day | Count and close that session before opening today's session |

## Worked examples

### Move a replacement tablet to the Melbourne register

The manager enters Melbourne's location code, selects **Front Till**, and completes setup. Alex signs in with their own username and PIN, counts $200 in the drawer, and opens the register with a $200 float. The header now shows Melbourne and Front Till before the first sale is charged.

## Related tasks

See **Selling, Payments, and Manager Approval** for checkout and **End of Day and Xero** for closing the session.