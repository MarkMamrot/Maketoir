---
{"id":"setup-team-access-security","title":"Team Access and Security","audiences":["ims"],"capability":"navigation","screen":"Setup > Team","product":"setup","format":"task","parentId":"setup-connections","contexts":["team"],"contextSections":{"team":"Step-by-step"},"relatedTopics":["setup-connections","setup-business-brand-appearance"],"order":3,"summary":"Invite the right person with the least access they need and handle sign-in security safely.","lastReviewed":"2026-08-29","owner":"security"}
---
# Team Access and Security
SuperAdmins can choose any active business with the top-bar selector while remaining signed in as themselves. This is business administration, not staff impersonation. See **Businesses and AI Plans** for the switching workflow and POS Device Setup behaviour.


Use Team to invite a colleague as a User or Admin, then let them complete their own secure account setup.

## Main operations

- Confirm the selected business and email address.
- Choose User unless the person needs full access and invitation rights.
- Send one invitation and check the result.
- Finish the user form with its action button, or leave it with **Cancel** or Escape; clicking outside does not discard it.
- Keep passwords, authenticator codes, and recovery codes private.
- Export business data only when authorised to handle the file.

## At a glance

| Role | Can use the app | Can invite team members | Suitable for |
| --- | --- | --- | --- |
| User | Yes | No | Day-to-day work that does not require full administration |
| Admin | Yes, with full access | Yes | Trusted people responsible for setup and team access |

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
5. Select **Send Invite Email** once.
6. Read the success or error message before trying again.
7. Ask the colleague to use their own invitation link and complete the sign-in steps shown to them.
8. If multi-factor authentication is requested, the colleague must enrol their own authenticator and store their own recovery codes securely.

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
| Invitation email does not arrive | Address is wrong, delayed, or filtered | Confirm the address and ask the recipient to check filtered mail before resending once |
| Invite reports an error | The address, role, or invitation state needs attention | Read the exact message and correct it before retrying |
| User cannot invite others | They have the User role | Ask an existing Admin to perform the invitation or review the role need |
| Sign-in requests an authenticator code | Multi-factor authentication is active | The account holder enters their own code or uses their own recovery route |
| Sign-in could not be completed | A temporary connection or service response interrupted verification | Keep the code private, wait a moment, and try signing in again |
| Export fails | Access or file preparation failed | Do not repeat rapidly; confirm authorisation and retry once later |

## Worked examples

### Invite a store coordinator

The coordinator needs products, reports, and normal workflows but will not manage users. Invite their confirmed work email as **User** and ask them to complete their own sign-in setup.

### Invite an operations administrator

The operations lead is responsible for connections and team invitations. After confirming that responsibility, invite them as **Admin**. Do not send them another person's password or recovery codes.