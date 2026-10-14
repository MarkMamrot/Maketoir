---
{"id":"setup-feature-rollouts","title":"Feature Rollouts","audiences":["ims"],"capability":"navigation","screen":"SuperAdmin > Feature Rollouts","product":"setup","format":"task","parentId":"setup-connections","contexts":["feature-rollouts"],"contextSections":{"feature-rollouts":"Step-by-step"},"relatedTopics":["foresight-workspaces","setup-team-access-security"],"order":5,"summary":"Control which businesses can see features that are being introduced progressively.","lastReviewed":"2026-10-13","owner":"platform","quickSections":["Main operations","At a glance"],"navigation":{"category":"platform","label":"Control feature rollouts"},"requiredTier":"SuperAdmin"}
---
# Feature Rollouts

Feature Rollouts lets a SuperAdmin enable experimental tools for selected businesses. Marketing Activities and AI Helper are marked **(Test)** and remain SuperAdmin-only even when enabled.

## Main operations

- Review each active business against the available feature columns.
- Turn a feature on for a business that is ready to use it.
- Turn a feature off when that business should no longer see it.
- Confirm the intended business and feature before changing the switch.

## At a glance

| Switch | Business experience |
| --- | --- |
| On | The test feature appears for SuperAdmins when that business next loads IMS |
| Off | The feature and its related navigation are hidden |

A missing rollout setting is treated as **Off**. This keeps newly registered businesses away from unfinished features until a SuperAdmin deliberately enables them.

## Before you begin

- Confirm you are signed in as a SuperAdmin.
- Confirm the business that should receive or lose the feature.
- Check that the business is ready for the feature and any required setup.
- Tell active users that they may need to reload the product after the change.

## Step-by-step

1. Open **Admin** and select **Feature Rollouts**.
2. Find the intended business row.
3. Read the feature heading and description.
4. Select its switch once.
5. Wait for the switch to show **On** or **Off**.
6. Ask the business to reload the relevant product if it is already open.

> **Important:** Feature Rollouts controls product availability for a business. It does not replace staff roles or permissions inside an enabled feature.

## Marketing Activities and AI Helper tests

**Marketing Activities (Test)** and **AI Helper (Test)** have independent switches. Both default to **Off**.

When Marketing Activities is on, a SuperAdmin can open **IMS > Automations > Marketing Activities (Test)** for marketing data sync, assistant, planning, recommendations, creative review, campaign audit, and Marketing Settings.

When AI Helper is on, a SuperAdmin can open **IMS > Automations > AI Helper (Test)** for advisory chat, data preview, and saved summaries.

Regular users, including business Admins and Standard Users, cannot see or open either test feature even when its business switch is on. Direct requests are also restricted. Unavailable test links return to the IMS Dashboard. The ordinary Ask Solvantis Help assistant remains available according to normal permissions.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A feature remains visible after switching it off | The business already had the product open | Reload the product and confirm the active business |
| A feature is absent after switching it on | The page has not reloaded or the parent product is unavailable | Reload, then confirm the business has access to the parent product |
| A switch returns to its earlier state | The change did not save | Read the displayed error and retry once |
| A staff member cannot perform an action inside an enabled feature | Their role does not permit that action | Review normal team access; do not use rollout flags to bypass permissions |

## Worked examples

A SuperAdmin enables Marketing Activities for one test business and reloads IMS. The SuperAdmin sees Marketing Activities under Automations. That business's regular staff still do not see it. AI Helper stays hidden until its separate switch is enabled.
