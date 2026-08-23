---
{"id":"wholesale-team-locations-permissions","title":"Team, Locations, and Permissions","audiences":["wholesale"],"capability":"wholesale","screen":"Wholesale Account","product":"wholesale","format":"task","parentId":"wholesale-portal","relatedTopics":["wholesale-getting-started-account-approval","wholesale-ordering-saved-lists-stock-rules"],"contexts":["account"],"contextSections":{"account":"Step-by-step"},"order":30,"summary":"Switch assigned buying locations and understand what Owners, Admins, and Buyers can manage.","lastReviewed":"2026-08-23","owner":"wholesale"}
---
# Team, Locations, and Permissions

Use Account to work in an assigned buying location and, when authorised, maintain addresses, locations, and team access.

## Main operations

- View the company, payment terms, current role, and active buying location.
- Switch among locations assigned to your membership.
- Edit the active location's billing and shipping addresses as an Owner or Admin.
- Add, rename, archive, and assign buying locations as an Owner or Admin.
- Add approved wholesale contacts and manage access within role limits.
- Review the recorded team and location change history.

## At a glance

| Action | Owner | Admin | Buyer |
|---|:---:|:---:|:---:|
| Browse, save drafts, submit orders, reorder | Yes | Yes | Yes |
| Switch among own assigned buying locations | Yes | Yes | Yes |
| View company terms and assigned-location addresses | Yes | Yes | Yes |
| Edit the active location's addresses | Yes | Yes | No |
| Create, rename, or archive eligible locations | Yes | Yes | No |
| Invite an approved Buyer | Yes | Yes | No |
| Invite an approved Admin | Yes | No | No |
| Change another member's role | Yes | No | No |
| Remove another Owner or Admin | Yes, subject to owner safeguards | No | No |
| Remove or reassign a Buyer | Yes | Yes | No |
| Manage all company saved lists | Yes | Yes | Own lists only |

## Before you begin

- [ ] Confirm your current role on the Account page.
- [ ] Confirm the colleague already has an active approved wholesale contact with the supplier.
- [ ] Decide which buying locations the colleague needs and which should be their default.
- [ ] Finish or move open drafts before attempting to archive a location.
- [ ] Keep at least one active Owner and at least one assigned location for every active member.

> **Important:** The active buying location controls the cart, drafts, order visibility, delivery address, and submitted order snapshot. Switch location before editing or ordering for another branch.

## Step-by-step

### Switch or update a buying location

1. Use the **Buying location** selector in the portal header to choose an assigned location.
2. Wait for the portal to reload and confirm the new location name.
3. Open **Account** to review its billing and shipping addresses.
4. If you are an Owner or Admin, select **Edit addresses**, make the changes, and save.
5. Remember that address changes apply when future orders are submitted; they do not rewrite existing submitted orders.

### Add a team member

1. As an Owner or Admin, open **Account** and find **Account team**.
2. Enter an email that already belongs to an approved wholesale contact.
3. Choose Buyer. An Owner can instead choose Admin.
4. Add the member, then assign one or more active buying locations.
5. Choose one assigned location as the default and save the location assignment.

## Location and role safeguards

| Change | Safeguard |
|---|---|
| Change your own access | Another account Owner must do it |
| Remove or demote the last Owner | Blocked; the account must retain an active Owner |
| Admin changes an Owner or another Admin | Blocked |
| Admin changes a Buyer's locations | Allowed, but the Buyer must retain at least one location |
| Archive the primary location | Blocked |
| Archive the currently selected location | Switch to another location first |
| Archive a location with an open draft | Resolve the draft first |
| Archive a member's only or default location | Assign and save another location first |

> **Tip:** Assign only the locations a person needs. This keeps their carts, drafts, addresses, and order history focused on the branches they actually buy for.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| A location is missing from the header | It is not assigned to the current member or is archived | Ask an Owner or Admin to review assignments |
| A colleague cannot be added | Their email is not an active approved wholesale contact, or it already belongs to an active account | Confirm the exact approved email with the supplier |
| Admin cannot edit a member | The target is an Owner or peer Admin | Ask an Owner to make the change |
| Location cannot be archived | It is primary, currently selected, has an open draft, or is someone's only/default assignment | Resolve the stated safeguard, then retry |
| Address save succeeds but an old order is unchanged | Submitted orders keep their historical address snapshot | Use the new address for future orders; contact the supplier about the existing order |

## Worked examples

### Give a buyer access to two shops

An Owner adds Lee's already approved email as a Buyer, assigns Brisbane CBD and Fortitude Valley, and chooses Brisbane CBD as the default. Lee signs in at Brisbane CBD but can switch to Fortitude Valley before creating that branch's cart. Lee can order for both locations but cannot edit addresses or team membership.

### Prepare a location for archiving

An Admin wants to archive a non-primary pop-up location. They first move or delete its open draft, assign another location as the default for affected Buyers, ensure each person retains at least one location, switch away from the pop-up, and then archive it.

## Related tasks

See **Ordering, Saved Lists, and Stock Rules** for location-bound carts and drafts, and **Getting Started and Account Approval** for approved-email access.