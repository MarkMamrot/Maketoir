---
{"id":"pos-store-daybook","title":"Store Daybook","audiences":["pos","ims"],"capability":"pos","screen":"POS > Store Daybook or IMS > Locations > Location Daybooks","product":"pos","format":"task","parentId":"pos-workspaces","relatedTopics":["pos-register-device-login","pos-end-of-day-xero","pos-branch-transfers","ims-business-operations-pos-settings"],"contexts":["daybook","store-daybook","location-daybooks"],"contextSections":{"daybook":"Step-by-step","store-daybook":"Step-by-step","location-daybooks":"Open a location Daybook from IMS"},"order":25,"summary":"Complete daily store tasks, acknowledge notices, and manage requests, needs, discrepancies, incidents, references, and product guidance.","lastReviewed":"2026-08-27","owner":"retail"}
---
# Store Daybook

Store Daybook is the shared daily workspace for the branch shown in POS. It keeps routine tasks, store notices and operational follow-up together without changing sales or stock records.

## Main operations

- Choose the staff member using Daybook for the current day.
- Complete and sign opening, throughout-the-day, weekly and closing tasks.
- Read and acknowledge store communications.
- See the names and initials of everyone who has acknowledged each communication.
- Record customer requests, store needs, stock discrepancies and incidents.
- Follow warehouse requests through packing, sending and receipt.
- Search approved reference information and product storage guidance.
- Add new items from the tab where they belong and choose an optional card colour.
- Let managers schedule tasks, publish store content and control who may edit existing items.

## At a glance

| Section | Use it for | Completion |
|---|---|---|
| Today | Opening, daily, weekly and closing tasks grouped by their scheduled day, with compact seven-day sign-off history | Staff name, initials, signed-in account and time are retained |
| Comms | Manager notices for selected stores | Each staff member selects **Mark as read** |
| Requests | Customer products and follow-up | Contacted, fulfilled or cancelled |
| Store needs | Consumables or stock needed from a warehouse | Requested, approved, packed, sent and received |
| Discrepancies | Differences between system and physical quantities | A manager records the stocktake outcome |
| Incidents | Factual safety, security, loss or damage reports | Staff sign on submission; managers review and close |
| References and Product guide | Approved store information, product photos, shelf and box locations | Managers maintain the content |

## Before you begin

- [ ] Confirm the POS header shows the store where the work is taking place.
- [ ] Open the POS menu and select **Store Daybook**.
- [ ] Choose your staff name or enter your name and initials.
- [ ] Check unread communications before beginning store tasks.
- [ ] Use the displayed date for the work being completed.

> **Important:** On a shared POS account, always choose the person doing the work. Solvantis also retains the signed-in account so the store has a complete audit history.

## Step-by-step

### Complete today's work

1. Open **Today** and use the clearly separated **Open the store**, **Keep the day moving**, or **Close with confidence** panels across the top.
2. Read tasks in the **Every day** or weekday group where they are scheduled. Weekly daytime work appears together under Monday, Tuesday and the other relevant weekdays.
3. Use the compact date headings and read across a task row to see signed initials, a task that was not signed, or a day when that task was not scheduled. Weekday names appear in the date headings and schedule group headings rather than repeating in every sign-off cell.
4. In the highlighted current-day column, select **Sign off** only after the work is complete.
5. Check that your initials appear in the cell. Hover or focus the cell to identify the signer and sign-off time.
6. After all opening tasks are signed, Daybook moves to **Keep the day moving**. After all of those tasks are signed, it moves to **Close with confidence**.
7. Select any phase across the top whenever you need to review it. Ask a manager to reopen a task if it was signed accidentally or needs to be repeated.

> **Note:** The seven-day table follows the date selected in the Daybook header. This makes it possible to review an earlier day and the six days leading up to it.

## Open a location Daybook from IMS

1. Open **Locations > Location Daybooks** in IMS.
2. Select an active location.
3. Use the location's full Daybook. Reads, edits and sign-offs retain both the selected staff identity and the signed-in IMS account for audit history.
4. Select the back arrow in the Daybook header to choose another location.

Location Daybooks is available when **Business requires POS** is enabled or when an active location already has POS configuration.

### Read a communication

1. Open **Comms**. Important and urgent notices are visually highlighted, with the newest notices first.
2. Review the names and initials below the notice to see who has already acknowledged it.
3. Read the full notice and select **Mark as read**.
4. Confirm your name and initials appear. Another staff member using the same register must acknowledge it under their own Daybook identity.

### Add operational follow-up

1. Open the relevant section: **Requests**, **Store needs**, **Discrepancies**, or **Incidents**.
2. Select **Add new** at the top of the tab.
3. Complete the popup fields, enter concise factual notes and optionally choose one of the seven card colours.
4. Submit the entry. Your staff identity and the signed-in account are recorded automatically.
5. Use the available status actions as work progresses. Receiving stores confirm a Store Need after the delivery arrives.

> **Warning:** A stock discrepancy is a manager stocktake queue, not a stock adjustment. Do not assume recording or closing it changes stock on hand.

### Report an incident

1. Enter the incident date and time, staff present and a factual description of what happened.
2. Record any loss or damage, whether emergency services were contacted, and whether management was told.
3. Include only personal details needed to identify and follow up the incident.
4. Select **Sign and submit report**. Managers control later review and closure.

### Add and edit Daybook content

Managers use **Add new** in Today, Comms, References and Product guide to add daily, weekly or one-date tasks, publish communications to selected stores, and maintain approved reference and product information. Staff use **Add new** in Requests, Store needs, Discrepancies and Incidents.

To add or edit a Product guide, search the active product list by product name, SKU or barcode and choose the matching variant. Daybook uses that catalogue product's primary photo automatically. A placeholder is shown when the product does not have a primary photo. The guide cannot be saved until a matching result is chosen.

Some imported storage-map entries may initially contain a shelf or storage description without a linked catalogue product. Edit the entry and select the exact product when one specific product applies; do not guess between similar variants.

When an item can be edited under the current policy, select its pencil button to open the same popup with the existing content. Four pastel and three light fluorescent backgrounds are available for communications, operational records, references and product guides. The default background remains available.

To remove an item, open its edit popup and select **Delete**. Review the warning and select **Delete item** to confirm. The item leaves the active Daybook, but its deletion audit and any existing task sign-offs, communication acknowledgments, incident history or workflow events are retained. Delete follows the same tenant-wide editing policy as other changes.

Managers open **Settings** and choose one tenant-wide editing policy:

| Policy | Who can revise an existing item |
|---|---|
| Original author only | The signed-in account or selected staff identity recorded when the item was created; managers can maintain imported items with no recorded author |
| Managers only | POS managers and administrators; this is the default and permits maintenance of imported content |
| Any staff member | Any staff member with access to Store Daybook |

Status changes and incident visibility still follow their separate operational permissions. Editing changes descriptive content; it does not rewrite sign-off or acknowledgment history.

## Privacy and access

| Information | Access and handling |
|---|---|
| Task sign-off | Visible to store staff and includes staff identity, account and time |
| Customer request | Use only the contact information needed for follow-up |
| Incident report | Treat as sensitive; managers control review and closure |
| Reference information | Store approved operational information only |
| Passwords, PINs and access keys | Never enter them in Daybook references, guides, tasks or communications |

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A task expected today is missing | Its recurrence, weekday or effective date does not include today | Ask a manager to review the task schedule |
| A previous-day cell says **Not signed** | The task was scheduled but no completion was recorded for that day | Confirm the work with the store team and follow the manager's process for missed checks |
| A sign-off has the wrong staff member | The shared-register identity was not changed | Ask a manager to reopen it, select the correct staff identity and complete it again |
| A notice still appears unread | It was acknowledged under another staff identity | Select your identity and use **Mark as read** |
| The pencil button is missing | The current editing policy does not permit this staff member to edit the item | Ask a manager to review **Settings** or make the correction |
| The Delete button is missing | Delete is available only from an item's permitted edit popup | Ask an allowed editor or manager to open the item with its pencil button |
| A Store Need cannot move to the next stage | An earlier warehouse stage is incomplete | Complete requested, approved, packed and sent in order |
| A discrepancy did not change stock | Daybook deliberately does not adjust inventory | A manager must stocktake and use the approved stock correction workflow |
| Product photo is blank | The linked catalogue product has no primary photo, or an imported entry is not linked yet | Add a primary product photo in the catalogue, or edit the imported entry and select the exact product |
| A Product guide cannot be saved | No active catalogue product has been selected | Search by product name, SKU or barcode and select a result before saving |

## Worked examples

### Weekly cleaning in the daily flow

A Tuesday cleaning task appears under **Keep the day moving** alongside any one-off task scheduled for that date. Lucinda completes both and signs once for each. Wednesday's tasks do not appear early, and the completed Tuesday records remain available in that date's Daybook.

### Store supply sent by the warehouse

Newtown requests large receipt rolls and selects the warehouse. Warehouse staff approve, pack and mark the request sent. Newtown confirms **Received** only after checking the physical delivery. Notes and times remain on the same request.

### Quantity difference for manager review

Staff find one item while the system shows three, so Daybook displays a variance of minus two. The manager plans a stocktake, verifies the quantity and records the outcome. The Daybook entry itself does not alter stock.

## Related tasks

See **Register, Device, and Login** for POS identity and location, **End of Day and Xero** for till reconciliation, and **POS Branch Transfers** when the work requires an inventory transfer rather than a Store Need.