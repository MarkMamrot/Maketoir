# SyncBooks landing-page prototype

An independent Next.js prototype for a service that connects Australian businesses with local, overseas and blended bookkeeping support.

## Local development

From this directory:

```bash
npm install
npm run dev
```

Open the local URL printed by Next.js. Use `npm run lint` and `npm run build` before handing off changes.

## Editing the prototype

- `app/page.tsx` contains the landing-page structure.
- `app/globals.css` contains the SyncBooks visual system and responsive rules.
- `lib/site-content.ts` contains pricing tiers, software expertise, services and FAQs.
- `components/consultation-form.tsx` contains the client-side consultation form demo.

## Adding supplied images

Create `public/images/` and add web-ready image files there. Use `next/image` when placing them on the page, provide meaningful alternative text and set a deliberate responsive crop. The current hero uses a bookkeeping dashboard treatment so the page remains complete while supplied photography is pending.

## Prototype limitations

The consultation form validates in the browser and displays a success state, but it does not send or store information. This prototype does not include a CRM, matching engine, authentication, database, bookkeeper profiles, payments or a CMS. Package prices are indicative, exclude GST and must be reviewed before publication.
