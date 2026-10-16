---
{"id":"ims-feature-toggle","title":"Feature Toggle","audiences":["ims"],"capability":"navigation","screen":"IMS Settings - Feature Toggle","product":"ims","format":"task","parentId":"ims-business-operations-pos-settings","relatedTopics":["ims-business-operations-pos-settings","ims-report-guide","ims-sales-channels","ims-consignment"],"contexts":["settings-feature-toggle"],"contextSections":{"settings-feature-toggle":"Main operations"},"order":91,"summary":"Admins and SuperAdmins can choose optional workspace features, enable default-off Consignments screens, and review the separate Consignment Tracking cutover or handover.","lastReviewed":"2026-10-17","owner":"setup","quickSections":["Main operations","Features"],"navigation":{"category":"settings","label":"Choose optional business features","sections":[{"heading":"Main operations","label":"Manage Feature Toggle settings"}]}}
---
# Feature Toggle

Choose which optional tools your team sees in Solvantis. These switches apply to the selected business, not just your own login.

## Main operations

Show or hide optional tools from **Settings > Business & Team > Feature Toggle**, then save your choices.

## At a glance

| Need | Setting | Effect |
|---|---|---|
| Simplify the workspace | Turn an optional feature off | Its entry points and screens are hidden |
| Restore a feature | Turn the same switch on | Existing data and configuration become accessible again |
| Keep normal catalogue maintenance | Leave Bulk Add/Edit unchanged | Its availability is independent of Bulk Edit |

## Before you begin

Select the intended business. You must be an Admin or SuperAdmin to save changes.

## Step-by-step

1. Open **Settings > Business & Team > Feature Toggle**.
2. Turn individual features on or off.
3. Select **Save feature toggles**. Wait for the saved confirmation.
4. Use **Cancel** to discard unsaved changes.

Only **Admins and SuperAdmins** can change these settings. Other IMS users can review the switches but cannot edit them.

Existing workspace switches are **on by default**, preserving existing behaviour. **Consignments is off by default**: enable it and save to show **Consignment Activity** in the Reports overview and **Consignment Statements** in Purchasing. Supplier shortcuts are shown only when this switch is enabled; saved links to hidden screens return to the Dashboard.

**Consignment Tracking is separately off by default** and uses a reviewed cutover or handover rather than the ordinary save button. With Consignments enabled, basic activity reporting and read-only historical statements remain available when tracking is off. Hiding Consignments does not stop tracking, change stock ownership or accounting treatment, or delete records.

For the existing workspace switches, turning a feature off hides its screens, navigation entries and relevant controls; saved links to a disabled workspace return to the Dashboard. Turning it back on makes it available again, subject to the user's usual permissions and connected-channel availability.

Existing records and saved configuration are retained. Background integrations, automated jobs and existing channel-rule processing are not stopped. These switches simplify the workspace; they are not a substitute for user permissions or integration activation controls.

> **Note:** To pause an integration or change a person's permissions, use the owning integration or user-management controls instead.

## Features

| Group | Switch | What is hidden when off |
|---|---|---|
| Workspaces | Shipping Workspace | The Shipping Workspace entry button and the selected-order Ship Orders action |
| Workspaces | CRM | CRM navigation, its workspace and customer CRM profiles; ordinary Contacts remain available |
| Products & Channels | Customs & compliance | The customs and compliance fields in the product editor; saved customs details remain intact |
| Products & Channels | Channel Listing Rules | Channel rule editors, automatic-assignment controls, rule filters, recommendations and Apply Rules actions; manual publishing remains available |
| Products & Channels | Bulk Edit | The Bulk Edit workspace only; **Bulk Add/Edit remains available** |
| Reports | Inactive Candidates | The Inactive Candidates report |
| Reports | Space Efficiency | The Space Efficiency report |
| Reports | Possible Losses | The Possible Losses report |
| Automations | Customer Service | The Customer Service group, including Inbox, Compose Email and Email Templates |
| Purchasing | Consignment Tracking | Managed statement creation and mutation controls; basic activity reporting and read-only historical statements remain available |
| Purchasing | Consignments | Consignment Activity in Reports, Consignment Statements in Purchasing, and supplier shortcuts to both screens; independent of settlement tracking |

The three report switches are independent. They do not hide the Reports section or other reports.

## Troubleshooting

| Symptom | What to check |
|---|---|
| A switch cannot be changed | Confirm you are an Admin or SuperAdmin and settings have finished loading |
| A feature is still hidden after enabling it | Save the switches, then check the user's usual permissions and required integrations |
| A save fails | Read the displayed error and retry; unsaved choices remain available |
| An integration continues running after a feature is hidden | This is expected; Feature Toggle controls the workspace, not background processing |

## Worked examples

### Keep catalogue maintenance simple

Turn **Bulk Edit** off and save. Its navigation entry and workspace are hidden, while **Bulk Add/Edit** remains available. Existing product data is unchanged.

### Hide one specialist report

Turn **Possible Losses** off and leave **Inactive Candidates** and **Space Efficiency** on. Save the changes. Only Possible Losses is hidden; the Reports section and the other two reports remain available.
