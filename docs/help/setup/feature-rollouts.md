---
{"id":"setup-feature-rollouts","title":"Feature Rollouts","audiences":["ims"],"capability":"navigation","screen":"SuperAdmin > Feature Rollouts","product":"setup","format":"task","parentId":"setup-connections","contexts":["feature-rollouts"],"contextSections":{"feature-rollouts":"Step-by-step"},"relatedTopics":["foresight-workspaces","setup-team-access-security"],"order":5,"summary":"Control which businesses can see features that are being introduced progressively.","lastReviewed":"2026-08-26","owner":"platform"}
---
# Feature Rollouts

Feature Rollouts lets a SuperAdmin introduce selected features to specific businesses before making them generally available.

## Main operations

- Review each active business against the available feature columns.
- Turn a feature on for a business that is ready to use it.
- Turn a feature off when that business should no longer see it.
- Confirm the intended business and feature before changing the switch.

## At a glance

| Switch | Business experience |
| --- | --- |
| On | The feature appears when that business next loads the product |
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

## Foresight Marketing

When **Foresight Marketing** is off, the business does not see Marketing Activities or Marketing Settings in Foresight. Old Marketing links return the user to the main Dashboard. Turning it on restores marketing data sync, assistant, planning, recommendations, creative review, campaign audit, and Marketing Settings according to the user's normal permissions.

## Troubleshooting

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| A feature remains visible after switching it off | The business already had the product open | Reload the product and confirm the active business |
| A feature is absent after switching it on | The page has not reloaded or the parent product is unavailable | Reload, then confirm the business has access to the parent product |
| A switch returns to its earlier state | The change did not save | Read the displayed error and retry once |
| A staff member cannot perform an action inside an enabled feature | Their role does not permit that action | Review normal team access; do not use rollout flags to bypass permissions |

## Worked examples

Monsterthreads is participating in the initial Foresight Marketing rollout. Its switch is On, while other businesses remain Off. Those other businesses continue to use the rest of Foresight without seeing the Marketing Activities menu.
