---
{"id":"ims-loyalty-customer-rewards","title":"Loyalty Program and Customer Rewards","audiences":["ims","pos"],"capability":"navigation","screen":"IMS Settings > Loyalty","product":"ims","format":"task","parentId":"ims-contacts-crm","relatedTopics":["ims-contacts-crm","ims-customer-orders","pos-selling-payments-manager-approval"],"contexts":["loyalty","contact-profile","pos","online-sales"],"contextSections":{"loyalty":"Step-by-step","contact-profile":"Customer enrolment","pos":"Use points at POS","online-sales":"Convert points for Shopify"},"order":42,"summary":"Configure loyalty, enrol customers, use points directly at POS, and convert points into customer-only Shopify discounts.","lastReviewed":"2026-08-28","owner":"customer"}
---
# Loyalty Program and Customer Rewards

Solvantis keeps the points balance and activity history. Loyalty is off until an administrator enables it, and each customer remains opted out until their membership is switched on or they accept the current terms in the customer rewards portal.

## At a glance

Enable the program in IMS, publish the Solvantis-hosted portal, then share its URL from Shopify. Customers can use points directly at POS or explicitly convert them into a Shopify-only discount.

## Before you begin

Confirm Shopify is connected, decide the earning rate, start date, and fixed-dollar rewards, and publish current loyalty terms and a privacy policy at HTTPS addresses.

> **Important:** Converting points creates a Shopify-only discount immediately. The points cannot then be used at POS or restored automatically when the code expires.

## Main operations

| What you need to do | Start here | Result |
|---|---|---|
| Configure earning and publish the portal | **IMS Settings > Loyalty** | Sets the program name, points rate, start date, portal address, and customer policy links |
| Enrol or opt out one customer | The customer's **CRM profile**, or the customer rewards portal | Changes only that customer's membership; their existing balance and history remain available after opt-out |
| Use points during an in-store sale | Link the customer in **POS**, then select an available reward | Applies the reward directly to that sale without creating or entering a code |
| Use points online | Customer rewards portal | Deducts points immediately and creates a single-use Shopify discount for that Shopify customer |
| Review balances and activity | Customer **CRM profile** or rewards portal | Shows the current balance, earning, redemption, and Shopify discount activity |

## Step-by-step

1. Open **IMS Settings > Loyalty**.
2. Enter the program name, points label, points earned per dollar, and start date.
3. Add each reward with a unique code, customer-facing name, whole-number points cost, and fixed AUD discount value. Switch off a reward to hide it without removing its redemption history.
4. Switch the loyalty program on and save it.
5. Enter a unique portal address, display name, Shopify store URL, loyalty terms URL and version, and privacy policy URL.
6. Publish the customer rewards portal.
7. Copy the displayed portal URL and add it to the Shopify navigation or customer communications.

Points expiry, VIP tiers, birthday rewards, referral bonuses, promotional multipliers, and annual earning caps are shown as unavailable settings. They do not affect balances or earning until those features are released.

Publishing requires both an enabled loyalty program and a connected Shopify store. The portal itself is hosted by Solvantis, while Shopify remains the online checkout.

## Customer enrolment

A customer signs in to the rewards portal using the email address on their Shopify customer account and a one-time six-digit code. New portal customers are not enrolled automatically. They must accept the current loyalty terms before joining.

Points begin on eligible purchases made after the effective enrolment date. Earlier orders are not backdated, including older Shopify orders imported or replayed later. If a customer opts out and later rejoins, future earning resumes from the new enrolment date.

## Use points at POS

Link the correct customer before selecting a reward. POS uses the customer's live Solvantis balance and applies the chosen reward directly to the sale. The customer does not need a voucher code.

Voiding an eligible sale reverses its loyalty effect through the linked sale history. Do not create a separate Shopify discount for a reward being used at POS.

## Convert points for Shopify

The customer chooses **Create Shopify discount** in the rewards portal and confirms the conversion. Solvantis deducts the required points immediately, then Shopify creates a discount that:

- can be used only by the linked Shopify customer;
- can be used once;
- cannot be combined with another discount; and
- expires after 90 days.

The issued code appears in the portal with a copy action and a **Shop now** link. A converted reward cannot also be used at POS and cannot be changed back into points from the portal. Expiry does not automatically restore points.

## Troubleshooting

| Symptom | Likely reason | What to do |
|---|---|---|
| No sign-in email arrives | The email does not identify exactly one Shopify customer, the message is delayed, or request limits were reached | Confirm the email on the Shopify customer, wait briefly, then request one new code |
| Portal cannot be published | Loyalty is off or Shopify is not connected | Save the enabled loyalty settings and confirm the Shopify connection |
| A customer has no available rewards | They are not enrolled, the program has not started, or their balance is below the reward cost | Check membership, start date, current balance, and reward setup |
| An old Shopify order earned no points | Its paid date is earlier than the customer's effective enrolment date | No correction is required; only future eligible purchases earn |
| A Shopify code cannot be created | Shopify rejected the discount or the points are no longer available | Refresh the portal and retry once; if it continues, ask an administrator to review Runtime Issues |
| An expired code still reduced the balance | Converting the reward deducted points immediately | Expired issued codes do not automatically return points |

## Worked examples

### Redeem directly in store

A customer has 1,200 points and chooses a 1,000-point reward at the register. Staff link the customer and apply the reward in POS. The balance becomes 200 points, with no code created.

### Convert for Shopify

A customer has 1,200 points and converts the same 1,000-point reward in the portal. Their balance immediately becomes 200 points. The portal displays a customer-only Shopify code for 90 days; those 1,000 points are no longer available at POS.
