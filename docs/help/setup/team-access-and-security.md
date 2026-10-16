---
{"id":"setup-team-access-security","title":"Team Access and Security","audiences":["ims"],"capability":"navigation","screen":"Settings > Users","product":"setup","format":"task","parentId":"setup-connections","contexts":["team","privacy"],"contextSections":{"team":"Step-by-step","privacy":"Privacy information and requests"},"relatedTopics":["setup-connections","setup-business-brand-appearance","ims-workspaces"],"order":3,"summary":"Enroll people in one or more businesses, send password reset links, review sign-in security activity, and find privacy request guidance.","lastReviewed":"2026-10-16","owner":"security","quickSections":["Main operations","At a glance"],"navigation":{"category":"settings","label":"Manage team access and security"}}
---
# Team Access and Security
SuperAdmins can choose any active business with the top-bar selector while remaining signed in as themselves. Other users who are enrolled in more than one business use the same selector for their enrolled businesses. This is business administration, not staff impersonation. See **Businesses and AI Plans** for the switching workflow and POS Device Setup behaviour.


Use Team to invite a colleague with the appropriate tier, then let them complete their own secure account setup. The same email address can be enrolled in multiple businesses without creating another account.

## Main operations

- Confirm the selected business and email address.
- Choose the least privileged tier that covers the person's work in this business.
- Choose **Set by Email** so the person creates their own password, then check the result.
- Open **Security** beside a user to send a one-hour password reset link or review their last 12 months of authentication activity.
- Finish the user form with its action button, or leave it with **Cancel** or Escape; clicking outside does not discard it.
- Keep passwords, authenticator codes, and recovery codes private.
- Export business data only when authorised to handle the file.

## At a glance

| Role | Can use the app | Can invite team members | Suitable for |
| --- | --- | --- | --- |
| User | Yes | No | Day-to-day work that does not require full administration |
| Admin | Yes, with full access | Yes | Trusted people responsible for setup and team access |

Access tiers are assigned separately for each business. For example, a person can be an Admin in one business and a Standard User in another. Changing or removing their access in one business does not alter their other enrollments.

## Assistant access

Ask Solvantis follows the person's verified access in the active business. It offers only supported read-only checks and cannot be used to bypass a hidden workspace, unavailable feature, or restricted account scope.

- IMS users, including Advisors, can ask supported read-only questions about products, stock, orders, contacts, purchasing, and sales reports.
- Advisor accounts cannot use Assistant checks for integration diagnostics or marketing.
- Admin and Standard User accounts can use Xero and Shopify checks only while the corresponding business capability is enabled.
- Marketing checks and the AI Helper workspace are SuperAdmin-only test features. Enabling them for a business does not make them available to regular staff.
- POS checks use only the location and register assigned to the signed-in POS session.
- Wholesale checks use only the signed-in member's company, location, role, and brand access.

Changing tier, business, register, or wholesale account changes the live checks available in the corresponding verified session. Help articles may explain a feature that the current account cannot open, but the Assistant will not retrieve that feature's private business records without access.

## Switching businesses

Users enrolled in two or more businesses can choose the active business from the top bar. The page reloads into that business and applies the tier assigned there. On the next sign-in, Solvantis opens the most recently active business; if none has been used yet, it opens the default enrollment.

## Privacy information and requests

The public [Privacy policy](/privacy) explains information collection, retailer responsibilities, connected providers, overseas processing, AI-assisted features, security history, retention and privacy requests. The separate [Amazon data handling notice](/amazon-data-handling) explains Amazon-specific processing and the current manual cleanup limitations.

- For access, correction or deletion requests, email **sales@solvantis.com** with the subject **Privacy request**. Identify the relevant account, retailer or conversation without including passwords or unnecessary customer details.
- Retail customers should normally contact the retailer first about their customer or purchase records. Identity and authority must be checked before records are disclosed or changed.
- The public Sales Assistant's **Delete conversation** removes that conversation's messages, not separately submitted contact requests, emails, security records or backups.
- Authentication history covers the last 12 calendar months. Closing an account or disconnecting an integration does not automatically delete historical sales records or every retained copy.
- Privacy complaints can be sent to the same address with the subject **Privacy complaint**.

## Before you begin

- Select the intended business.
- Confirm the colleague's current work email directly with them.
- Decide whether they truly need Admin access.
- Make sure they can receive the invitation and complete their own sign-in setup.

> **Warning:** Never ask a colleague to share their password, authenticator code, or recovery code. Support and administrators should not need those values.

## Step-by-step

1. Open **Team** in Setup.
2. Confirm the business named on the page.
3. Enter the colleague's email address.
4. Choose **User** or **Admin** from the role list.
5. In **Password**, keep **Set by Email** selected. Use **Set Manually** only when an authorised support process specifically requires it.
6. Select **Create** once.
7. Read the success or error message before trying again.
8. Ask the colleague to use the one-hour password setup link and complete the sign-in steps shown to them.
9. The colleague must complete multi-factor authentication and store their own recovery codes securely. A valid remembered browser can satisfy the existing trusted-browser check.

## Platform password and sign-in rules

Named platform accounts, including SuperAdmins, Admins, staff and Advisors, use the same password and multi-factor sign-in rules. These rules do not change cashier PINs or separate wholesale and online-shop customer sign-ins.

- Passwords require at least 12 characters, uppercase and lowercase letters, a number, and a non-whitespace special character.
- Passwords must not contain the person's name, username, or full sign-in email. Control characters are not accepted, and the maximum is 72 UTF-8 bytes; non-English characters can use more than one byte.
- The current password and the previous nine passwords cannot be reused.
- A known-age password must normally be at least one day old before replacement and must be renewed after 365 days. Accounts without a recorded password age must renew at their next sign-in, with no grace period.
- Five unsuccessful platform sign-in attempts trigger a 30-minute account-wide lock; changing network or IP address does not bypass it.
- Use **Forgot password** when renewal is required. If a suspected compromise needs urgent action during the one-day minimum age, contact the responsible administrator for incident containment rather than repeatedly requesting links.

## Password resets and authentication activity

Admins and SuperAdmins can open **Settings > Users**, select **Security** beside a user in the active business, and send that person a password reset email. The administrator never chooses or sees the password. Sending a new link invalidates earlier unused links, and each link expires after one hour.

The Security panel shows the latest 250 entries from the last 12 calendar months. Activity includes completed and failed sign-ins, lockouts, password-renewal requirements, MFA failures/enrollment, recovery-code and trusted-browser use, reset-email requests, and completed password changes. Entries can include the client IP address, browser description, and an approximate city, region, and country when the hosting network supplies that information. Approximate location may be unavailable or inaccurate. Only Admins and SuperAdmins for the active business can view this account history. Older activity is removed automatically; previously deleted history cannot be recovered.

Changing a password revokes remembered browsers and incomplete authentication challenges and signs out the browser completing the reset. Existing authenticator enrollment and recovery codes remain with the account. Other already-issued platform sessions can remain valid for their existing maximum eight-hour lifetime; a routine reset does not immediately revoke every browser. New sessions cannot extend past the password's expiry. Suspected compromise requires the separate incident-containment process.

If the email already belongs to a Solvantis account, accepting the invitation adds this business to that account. It does not replace the person's other business access.

The user form stays open if you click outside it. Select **Cancel** or press Escape when you intentionally want to leave without saving.

## Role and security decisions

| Decision | Choose | Reason |
| --- | --- | --- |
| Person only needs normal application work | User | Limits team-management access |
| Person must manage setup and invite others | Admin | Grants full application access and invitation rights |
| Email address may be wrong | Stop | Confirm it before sending an invitation |
| Someone asks for a sign-in or recovery code | Do not share | Codes belong only to the account holder |
| Business export is needed | Use Data Export only when authorised | The downloaded file contains business information even though protected connection details are excluded |

## Troubleshooting

| Symptom | Likely cause | Safe action |
| --- | --- | --- |
| Password setup email does not arrive | Address is wrong, delayed, or filtered | Confirm the address and ask the recipient to check filtered mail before creating or sending another link |
| Location shows as unavailable | The hosting network did not supply coarse location information | Use the timestamp and IP address when reviewing the event; do not treat location as exact proof |
| Invite reports an error | The address, role, or invitation state needs attention | Read the exact message and correct it before retrying |
| User cannot invite others | They have the User role | Ask an existing Admin to perform the invitation or review the role need |
| User cannot see a business in the selector | They are not actively enrolled in that business | Ask a SuperAdmin or an Admin of that business to review the enrollment |
| User has different permissions after switching | Their tier differs between businesses | Review the tier assigned in the currently selected business |
| User loses access to one business | Their enrollment in that business was removed | They can continue using any other business where they remain enrolled |
| Sign-in requests an authenticator code | Multi-factor authentication is active | The account holder enters their own code or uses their own recovery route |
| Sign-in could not be completed | A temporary connection or service response interrupted verification | Keep the code private, wait a moment, and try signing in again |
| Export fails | Access or file preparation failed | Do not repeat rapidly; confirm authorisation and retry once later |

## Worked examples

### Invite a store coordinator

The coordinator needs products, reports, and normal workflows but will not manage users. Invite their confirmed work email as **User** and ask them to complete their own sign-in setup.

### Invite an operations administrator

The operations lead is responsible for connections and team invitations. After confirming that responsibility, invite them as **Admin**. Do not send them another person's password or recovery codes.