---
{"id":"setup-businesses-ai-plans","title":"Businesses and AI Plans","audiences":["ims"],"capability":"navigation","screen":"SuperAdmin > Businesses","product":"setup","format":"task","parentId":"setup-connections","contexts":["businesses"],"contextSections":{"businesses":"Step-by-step"},"relatedTopics":["ims-settings-account-ai-credits","setup-feature-rollouts","setup-team-access-security"],"order":4,"summary":"Manage business access, operating limits, environment safeguards, and the assigned Solvantis AI plan.","lastReviewed":"2026-08-31","owner":"platform"}
---
# Businesses and AI Plans

Use Businesses to onboard and administer each Solvantis business. Business Settings contains module access, environment safeguards, operating limits, billing values, and the business's Solvantis AI plan.

## Main operations

- Open a business's settings and change its Solvantis AI plan.
- Select any active business and administer it with your own SuperAdmin account.
- Enable or disable Intel & Automation, IMS, and POS access.
- Identify sandbox businesses and pause their scheduled automation when required.
- Set location and user limits and the monthly cost per location.
- Open AI Usage & Credits for funding, enforcement, usage, and rate controls.
- Compare supported Google Billing prices with current provider rates before approving changes.
- Review saved active provider rates whenever the AI Usage & Credits page opens.
- Choose explicit sell rates or a persistent flat markup independently for each AI plan.
- Select which active provider-priced models tenants can choose and use throughout Solvantis.

## At a glance

| Control | Where to manage it | Effect |
| --- | --- | --- |
| Active business | Top bar or **Businesses > Open IMS** | Changes which business's IMS, POS, integrations, settings, and operational data are active |
| Solvantis AI plan | **Businesses > Settings** | Selects the sell-rate plan for future AI usage |
| Module access | **Businesses > Settings** | Controls access to Intel & Automation, IMS, and POS |
| Sandbox and automation | **Businesses > Settings** | Identifies test businesses and can stop scheduled automation |
| AI funding and enforcement | **AI Usage & Credits** | Controls prepaid credit or account limits and exhaustion behaviour |
| Google provider rates | **AI Usage & Credits > Rate cards** | Previews supported Google Billing prices and activates only selected changes |
| Active provider rates | **AI Usage & Credits > Rate cards** | Shows current provider costs and controls which priced models tenants may select or use |
| Plan pricing | **AI Usage & Credits > Rate cards** | Chooses explicit sell rates or a saved flat provider markup independently for each plan |
| Active plan sell rates | **AI Usage & Credits > Rate cards** | Shows and edits current customer rates only for plans using explicit sell rates |
| Manual AI rates | **AI Usage & Credits > Rate cards** | Adds effective provider-cost and plan sell rates without changing rate history |

## Before you begin

- Sign in with SuperAdmin access.
- Finish or park any POS sale before changing businesses.
- Confirm the requested plan and commercial arrangement before saving it.
- Check the business name carefully, especially when a sandbox has a similar name.
- For Google rate synchronization, confirm the billing connection is available before starting.

> **Important:** Changing the Solvantis AI plan changes the rates used for future AI usage. It does not add prepaid credit, reset current-cycle usage, or alter funding and enforcement settings.

> **Important:** Selecting a business does not sign in as one of its staff. You remain the same SuperAdmin with full administrator permissions; only the active business and its data change.

## Step-by-step

1. Open **Admin > Businesses**.
2. Find the business and select **Settings**.
3. Review the business name and module access.
4. Under **Plan Limits & Billing**, choose the **Solvantis AI Plan**.
5. Review location, user, and cost-per-location values.
6. Select **Save Changes**.
7. Open **AI Usage & Credits** only when funding, enforcement, cycle, credit, or rate controls also need attention.

### Work in a business

1. Open **Admin > Businesses**.
2. Find the active business you need to administer.
3. Use **Open IMS**, or choose the business with the top-bar **Business** selector.
4. Wait for the workspace to reload and confirm the selected business name in the top bar before viewing or changing data.
5. Move between IMS, Intel & Automation, Setup, and POS as needed. Your SuperAdmin permissions remain available.
6. To return, choose another business, including your usual business, from the same selector.

When POS was configured for a different business, it returns to Device Setup after the change. Select a location and register belonging to the newly active business. Carts, parked sales, product caches, and offline queues remain separated by business.

> **Warning:** Always confirm the active business before changing stock, orders, payments, integrations, or accounting settings. Changing the active business reloads the workspace and closes any unsaved screen state.

### Review Google provider rates

1. Open **Admin > AI Usage & Credits**.
2. In **Rate cards**, select **Sync Google rates**.
3. Review each supported rate's current value, Google value, status, model, metric, and SKU.
	**Active and current** means every supported Google price already matches its active provider rate. **Ready for approval** means one or more supported changes are selected but not yet active.
4. Expand the manual-review list and assess any unsupported tier, threshold, storage, tool, or modality prices separately.
5. Clear the checkbox for any supported change that should not be activated.
6. Select **Approve selected** and confirm the change.
7. Refresh the preview and confirm approved rows now show **Unchanged**.

> **Important:** Synchronization does not activate prices automatically. Google prices are retrieved again during approval, and approval stops when a selected price no longer matches the reviewed proposal.

Solvantis represents Gemini Pro prices at their published context boundary. Metrics ending in **Over 200k** apply when the prompt, including cached input, exceeds 200,000 tokens. Standard token metrics apply at or below that boundary.

Nano Banana models use **Output image tokens** because Google prices generated images by token consumption and resolution. The provider and sell-rate tables therefore show image-output token rates separately from flat **Output image** rates used by providers that charge per generated image.

Each model under **Active provider rates** has one **Allowed** checkbox. Only checked models appear in tenant AI model selectors. Unchecking a model also blocks new direct AI requests that submit its model ID. A model must have an active provider rate before it can be allowed.

### Configure plan pricing

1. Open **Admin > AI Usage & Credits**.
2. Under **Active provider rates**, confirm the saved provider costs and effective dates.
3. Check **Allowed** for each model tenants may select and use.
4. Under **Plan pricing**, choose **Active sell rates** or **Flat markup** for each plan.
5. For each **Flat markup** plan, enter its markup percentage.
6. Select **Save plan pricing**.
7. Refresh the page and confirm the modes and percentages remain displayed.

The calculation is **customer sell rate = active provider cost × (1 + markup percentage)**. For example, a 25% markup changes a $1.00 provider rate to a $1.25 customer sell rate. The amount is rounded up to the nearest AUD micro where required.

> **Important:** Flat markup mode does not create plan sell-rate rows. Solvantis applies the saved percentage to the provider rate that is active whenever each AI call starts. Provider price changes therefore flow through automatically. A markup percentage is not the same as a target gross-margin percentage.

> **Important:** Active sell rates and flat markup are mutually exclusive for each plan. Existing explicit rate history remains available, but explicit rates are ignored while that plan uses flat markup.

### Review or edit a sell rate

1. Confirm the plan uses **Active sell rates** under **Plan pricing**.
2. Under **Active plan sell rates**, choose a plan or leave **All plans** selected.
3. Review the model, metric, sell rate, implied markup, and effective time.
4. Select **Edit** on the required row.
5. In **Edit sell rate**, change the AUD price or effective time and verify the plan, model, metric, and unit scale.
6. Select **Save new effective rate**.

> **Important:** Editing does not alter the rate used by historical AI calls. It ends the previous active rate at the selected effective time and creates a replacement for future usage.

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| A business is missing from the selector | The business was deleted or is an internal platform account | Check **Admin > Businesses** and select an active operating business |
| The workspace returns to sign-in while switching | The original signed-in session expired | Sign in again; changing businesses does not extend the session |
| POS returns to Device Setup | Its saved location belongs to the previously active business | Select a location and register for the current business before continuing |
| The expected features or connections are missing | The selected business has different module access, rollout settings, or connections | Confirm the active business, then review its Business Settings and Connections |
| The AI plan is still loading | AI account details have not returned yet | Wait briefly and reopen Settings if loading does not finish |
| The plan cannot be changed | The business does not have an available AI account | Review AI Usage & Credits and contact platform support |
| Saving reports that only the AI plan failed | Business settings saved but the AI account update did not | Verify the plan and retry after checking the reported error |
| AI remains unavailable after a plan change | Funding is exhausted, enforcement is active, or the account is suspended | Review the business in AI Usage & Credits |
| A deleted business is missing | Deleted rows are hidden by default | Enable **Show deleted** for historical review |
| Google rate preview cannot connect | The billing account, billing connection, access permission, or Cloud Billing API is unavailable | Ask a platform administrator to restore the Google Billing connection, then retry |
| A Google SKU appears under manual review | Its pricing has tiers, thresholds, storage, tools, modalities, or conflicts with another SKU mapped to the same model and metric | Verify the Google price and add an approved manual rate only when its model, metric, unit, and effective time are clear. Equivalent SKUs with the same price are consolidated automatically |
| Approval asks for another review | Google returned a different set of supported prices during approval | Run **Sync Google rates** again and review the current proposal |
| Saved provider rates disappear after leaving the page | The page did not finish loading or the rate request failed | Refresh AI Usage & Credits; active provider rates should appear without running Google sync |
| Save plan pricing is unavailable | No active provider rates exist | Sync or add provider rates, then retry |
| A sell rate is not visible | The plan uses flat markup, a different plan filter is selected, or the rate is not currently effective | Choose **Active sell rates** for that plan, check the filter, and refresh |
| A model is missing from tenant selectors | It is unchecked, lacks an active provider rate, or the tenant plan lacks a usable price | Check **Allowed**, confirm current provider pricing, and configure that plan's pricing mode |
| A previously selected model stops working | A SuperAdmin disabled it or its effective provider pricing ended | Select another allowed model or restore current provider pricing and permission |

## Worked examples

### Resolve an issue in another business

A SuperAdmin is signed in under Solvantis and needs to correct a purchase order for Sage. They choose **Sage** in the top bar, wait for IMS to reload, and confirm Sage is displayed before opening the order. They remain the same SuperAdmin throughout. After finishing, they choose **Solvantis** to return to their usual workspace.

### Move a business to a different AI plan

A business is approved to move from Starter to Core. A SuperAdmin opens that business's Settings, changes **Solvantis AI Plan** to **Core**, and saves. Existing prepaid credit or current-cycle usage remains unchanged. Future AI usage is valued using the applicable Core rates.

### Keep plan and funding controls separate

A business remains on Scale but needs additional prepaid value. The SuperAdmin leaves its plan unchanged in Business Settings, opens **AI Usage & Credits**, and records the approved credit adjustment with its reference and reason.

### Approve changed Google rates

The preview shows changed Gemini Flash rates and new standard and over-200k Gemini Pro rates. The SuperAdmin approves the checked rows, verifies the model is allowed under **Active provider rates**, and keeps earlier prices for historical usage. Plans using flat markup automatically value future calls from the new provider rates; plans using active sell rates continue using their explicit prices until changed.