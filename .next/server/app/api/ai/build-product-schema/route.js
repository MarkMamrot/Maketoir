(()=>{var e={};e.id=2289,e.ids=[2289],e.modules={62849:e=>{function t(e){var t=Error("Cannot find module '"+e+"'");throw t.code="MODULE_NOT_FOUND",t}t.keys=()=>[],t.resolve=t,t.id=62849,e.exports=t},72934:e=>{"use strict";e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{"use strict";e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{"use strict";e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{"use strict";e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{"use strict";e.exports=require("assert")},78893:e=>{"use strict";e.exports=require("buffer")},61282:e=>{"use strict";e.exports=require("child_process")},84770:e=>{"use strict";e.exports=require("crypto")},17702:e=>{"use strict";e.exports=require("events")},92048:e=>{"use strict";e.exports=require("fs")},20629:e=>{"use strict";e.exports=require("fs/promises")},32615:e=>{"use strict";e.exports=require("http")},32694:e=>{"use strict";e.exports=require("http2")},35240:e=>{"use strict";e.exports=require("https")},98216:e=>{"use strict";e.exports=require("net")},19801:e=>{"use strict";e.exports=require("os")},55315:e=>{"use strict";e.exports=require("path")},35816:e=>{"use strict";e.exports=require("process")},68621:e=>{"use strict";e.exports=require("punycode")},86624:e=>{"use strict";e.exports=require("querystring")},76162:e=>{"use strict";e.exports=require("stream")},74026:e=>{"use strict";e.exports=require("string_decoder")},95346:e=>{"use strict";e.exports=require("timers")},82452:e=>{"use strict";e.exports=require("tls")},74175:e=>{"use strict";e.exports=require("tty")},17360:e=>{"use strict";e.exports=require("url")},21764:e=>{"use strict";e.exports=require("util")},6162:e=>{"use strict";e.exports=require("worker_threads")},71568:e=>{"use strict";e.exports=require("zlib")},72254:e=>{"use strict";e.exports=require("node:buffer")},65714:e=>{"use strict";e.exports=require("node:diagnostics_channel")},15673:e=>{"use strict";e.exports=require("node:events")},87561:e=>{"use strict";e.exports=require("node:fs")},88849:e=>{"use strict";e.exports=require("node:http")},22286:e=>{"use strict";e.exports=require("node:https")},87503:e=>{"use strict";e.exports=require("node:net")},49411:e=>{"use strict";e.exports=require("node:path")},97742:e=>{"use strict";e.exports=require("node:process")},84492:e=>{"use strict";e.exports=require("node:stream")},76402:e=>{"use strict";e.exports=require("node:stream/promises")},72477:e=>{"use strict";e.exports=require("node:stream/web")},41041:e=>{"use strict";e.exports=require("node:url")},47261:e=>{"use strict";e.exports=require("node:util")},65628:e=>{"use strict";e.exports=require("node:zlib")},58359:()=>{},93739:()=>{},75668:(e,t,r)=>{"use strict";r.r(t),r.d(t,{originalPathname:()=>x,patchFetch:()=>A,requestAsyncStorage:()=>w,routeModule:()=>S,serverHooks:()=>v,staticGenerationAsyncStorage:()=>E});var s={};r.r(s),r.d(s,{POST:()=>b});var a=r(49303),i=r(88716),n=r(60670),o=r(87070),c=r(71615),l=r(58954),u=r(35857),d=r(56293),p=r(23237),m=r(14419),h=r(33203);async function g(e){try{let t=await d.u.get(e);if(!t)return null;return{mission:t.mission||"",uvp:t.uvp||"",tone:t.tone||"",demographics:t.demographics||"",geo:t.geo||"",products:t.hero_products||"",pricing:t.price_positioning||"",praises:t.customer_praises||"",objections:t.objections||"",competitors:t.competitors||"",marketGap:t.market_gap||"",logoUrl:t.logo_url||"",brandColours:t.brand_colours||"",shippingPolicy:t.shipping_policy||"",connectedSoftware:t.connected_software||"",operationsSummary:t.operations_summary||"",returnsPolicy:t.returns_policy||"",brandHistory:t.brand_history||"",physicalBranches:t.physical_branches||""}}catch{return null}}async function _(e){try{let t=await (0,m.PQ)(e).catch(()=>e),r=await u.vg.get(e).catch(()=>null),s=r?.website_sheet_id;if(s){let e=new h.GoogleSheetsService,t=await e.getData(s,"Shopify_Products").catch(()=>null);if(t&&t.length>1)return t.slice(1,8)}return(await p.g.list(t)).slice(0,7).map(e=>[String(e.code??""),String(e.name??""),String(e.brand??""),String(e.retail_price??"")])}catch{}return[]}let y=`Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "toneGuide": "A paragraph describing the voice, tone, and personality to use across all product descriptions.",
  "writingRules": ["Array of 4-8 concise dos and don'ts rules for writing product descriptions"],
  "fields": [
    {
      "name": "fieldName (camelCase key)",
      "label": "The actual heading text shown inside the product description — customer-visible, written in the brand voice (e.g. 'Key Features', 'Why You Will Love It', 'Dimensions & Materials', 'Gift Wrapping & Delivery'). NOT a template meta-name like 'Headline' or 'Short Description'. Should read naturally as a section heading within the product page.",
      "description": "What this field is and when to use it (internal note only, not shown to customers)",
      "format": "How to write it — structure, sentence pattern, etc.",
      "maxLength": 120,
      "example": "Example text or array of example strings for list fields"
    }
  ],
  "exampleProduct": {
    "name": "Product name taken from the sample products",
    "fieldName1": "Completed example value",
    "fieldName2": "Completed example value"
  }
}
IMPORTANT: Fields are ONLY for the visible customer-facing product description shown on the product page. Do NOT include SEO titles, meta descriptions, meta tags, schema markup, or any backend/technical fields. Those are managed separately.
The fields array must be tailored to the brand and product type — include as many or as few fields as make sense.
The label for each field is the ACTUAL HEADING that will appear in the product description. It must sound natural as a section heading a shopper would read, and reflect the brand's voice — not a template meta-name.
The exampleProduct must fill in every field using one real product from the sample products provided.
Respond with ONLY valid JSON, no markdown, no explanation.`,f=y+`

For a typical eCommerce brand, consider starting with fields such as: headline, shortDescription, longDescription, bulletPoints, calloutBadge — but adapt and add/remove freely based on the brand, product type, and customer.`;async function b(e){try{let r,s;let a=(0,c.cookies)().get("marketoir_session");if(!a?.value)return o.NextResponse.json({error:"Unauthorized."},{status:401});let i=await e.json(),{databaseId:n,mode:d,existingSchema:p,userComments:m}=i,h=i.type||"description";if(!n)return o.NextResponse.json({error:"Missing databaseId."},{status:400});let b=process.env.GEMINI_API_KEY;if(!b)return o.NextResponse.json({error:"Gemini API key not configured."},{status:500});let S="gemini-2.5-pro-preview";try{let e=await u.vg.get(n).catch(()=>null);e?.gemini_model&&(S=e.gemini_model)}catch{}if("title"===h||"tags"===h){let[t,r,s]=await Promise.all([g(n),_(n),fetch(`${process.env.NEXTAUTH_URL||"http://localhost:3000"}/api/user/business-info?databaseId=${encodeURIComponent(n)}`,{headers:{cookie:e.headers.get("cookie")||""}}).then(e=>e.ok?e.json():{}).catch(()=>({}))]),a=s.brandName||"Brand",i="title"===h?function(e,t,r){let s=t?`
BRAND PROFILE:
- Mission: ${t.mission}
- Unique Value Proposition: ${t.uvp}
- Brand Tone: ${t.tone}
- Target Demographics: ${t.demographics}
- Geographic Markets: ${t.geo}
- Hero Products: ${t.products}
- Price Positioning: ${t.pricing}
- Customer Praises: ${t.praises}
- Customer Objections: ${t.objections}
- Competitors: ${t.competitors}
- Market Gap / Advantage: ${t.marketGap}
- Logo URL: ${t.logoUrl}
- Shipping Policy: ${t.shippingPolicy}
- Returns Policy: ${t.returnsPolicy}
- Connected Software: ${t.connectedSoftware}
- Operations Summary: ${t.operationsSummary}
- Brand History: ${t.brandHistory}
- Physical Branches: ${t.physicalBranches}
`.trim():"",a=["id","variant_id","handle","title","status","product_type","vendor","tags","description_html","price","compare_at_price","sku","barcode","inventory_qty","weight","image_url","variant_count","image_count","published_at","updated_at"],i=r.length>0?`
SAMPLE PRODUCTS:
${r.map(e=>{let t=t=>e[a.indexOf(t)]||"";return`- ${t("title")} | Type: ${t("product_type")} | Price: $${t("price")}`}).join("\n")}
`.trim():"";return`
You are an expert eCommerce SEO and conversion specialist.
Your task is to build a Product Title Schema for the brand "${e}".
This schema defines rules the AI follows every time it writes or rewrites a product title.

${s}

${i}

Based on the brand, product types, and price point above — design a title schema that:
1. Balances SEO discoverability with brand voice
2. Is consistent and scannable in search results and collection pages
3. Avoids filler words and repetition
4. Fits within the recommended character limit for Shopify titles

Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "toneGuide": "One paragraph describing how product titles should sound — the voice, brevity, and personality.",
  "maxLength": 70,
  "formatRules": [
    "4-8 concise rules for constructing titles — e.g. 'Start with brand name', 'Include key attribute after a dash', 'Never repeat the category word'"
  ],
  "formulaExamples": [
    "2-4 example formulas showing the title structure, e.g. '[Brand] [Product Name] – [Key Attribute]'"
  ]
}
Respond with ONLY valid JSON, no markdown, no explanation.
`.trim()}(a,t,r):function(e,t,r){let s=t?`
BRAND PROFILE:
- Mission: ${t.mission}
- Unique Value Proposition: ${t.uvp}
- Brand Tone: ${t.tone}
- Target Demographics: ${t.demographics}
- Geographic Markets: ${t.geo}
- Hero Products: ${t.products}
- Price Positioning: ${t.pricing}
- Customer Praises: ${t.praises}
- Customer Objections: ${t.objections}
- Competitors: ${t.competitors}
- Market Gap / Advantage: ${t.marketGap}
- Logo URL: ${t.logoUrl}
- Shipping Policy: ${t.shippingPolicy}
- Returns Policy: ${t.returnsPolicy}
- Connected Software: ${t.connectedSoftware}
- Operations Summary: ${t.operationsSummary}
- Brand History: ${t.brandHistory}
- Physical Branches: ${t.physicalBranches}
`.trim():"",a=["id","variant_id","handle","title","status","product_type","vendor","tags","description_html","price","compare_at_price","sku","barcode","inventory_qty","weight","image_url","variant_count","image_count","published_at","updated_at"],i=r.length>0?`
SAMPLE PRODUCTS (showing existing tags for reference):
${r.map(e=>{let t=t=>e[a.indexOf(t)]||"";return`- ${t("title")} | Tags: ${t("tags")||"(none)"}`}).join("\n")}
`.trim():"";return`
You are an expert eCommerce merchandising and SEO specialist.
Your task is to build a Product Tagging Strategy for the brand "${e}".
This schema defines the rules the AI follows every time it writes or rewrites product tags.

${s}

${i}

Tags on Shopify are used for filtering, collections, and internal search. Design a tagging strategy that:
1. Makes products easy to find and filter
2. Is consistent in naming conventions (e.g. always lowercase, always use hyphens)
3. Covers useful dimensions like material, colour, use-case, audience, and occasion
4. Includes brand-specific tags that are always required
5. Avoids generic noise words and redundant tags

Return a single JSON object with EXACTLY these keys — no markdown, no extra keys:
{
  "instructions": "Comprehensive paragraph-style instructions for the AI: what dimensions to tag (material, colour, use-case, audience, occasion, etc.), naming conventions (case, separators), max tag count, and any brand-specific rules.",
  "requiredTags": ["Tags that MUST always be included on every product, e.g. the brand name"],
  "excludedTerms": ["Words or phrases to NEVER use as tags — e.g. generic filler words, competitor names"]
}
Respond with ONLY valid JSON, no markdown, no explanation.
`.trim()}(a,t,r),c=new l.fA({apiKey:b}),u=await c.models.generateContent({model:S,contents:i}),d=u.text?.trim()??"",p=d.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();try{let e=JSON.parse(p);if("title"===h)return o.NextResponse.json({success:!0,titleSchema:e});return o.NextResponse.json({success:!0,tagsSchema:e})}catch{return console.error(`Gemini returned non-JSON for ${h}:`,d.slice(0,200)),o.NextResponse.json({error:"AI returned an unexpected format. Please try again."},{status:500})}}let w="refine"===d;if("regen-example"===d){if(!p)return o.NextResponse.json({error:"Missing existing schema for example regeneration."},{status:400});let e=await _(n),t=function(e,t){let r=t.slice(1,8).map(e=>e[1]?.trim()).filter(Boolean),s=r.length>0?r.join(", "):"the brand's products",a=e.exampleProduct?.name??"",i=e.fields.map(e=>{let t=e.count||Array.isArray(e.example);return`- "${e.name}" (${t?`array of ${e.count??3} strings`:"string"}): ${e.format??e.description??""}`}).join("\n");return`You are an expert eCommerce copywriter. Generate fresh, vivid example product copy for this template.

TEMPLATE TONE:
${e.toneGuide}

WRITING RULES:
${(e.writingRules??[]).map(e=>`- ${e}`).join("\n")}

AVAILABLE PRODUCTS:
${s}
${a?`
Please use a DIFFERENT product than the current example: "${a}"`:""}
FIELDS TO FILL:
${i}

TASK: Fill in every field with realistic, compelling copy for one of the available products. Follow the tone and writing rules strictly.

Return ONLY valid JSON — no markdown, no explanation:
{
  "exampleProduct": {
    "name": "Product name",
    "field1": "value or array"
  }
}`.trim()}(p,e),r=new l.fA({apiKey:b}),s=await r.models.generateContent({model:S,contents:t}),a=s.text?.trim()??"",i=a.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();try{let e=JSON.parse(i);if(!e.exampleProduct)throw Error("Missing exampleProduct key");return o.NextResponse.json({success:!0,exampleProduct:e.exampleProduct})}catch{return console.error("Gemini returned non-JSON for regen-example:",a.slice(0,200)),o.NextResponse.json({error:"AI returned an unexpected format. Please try again."},{status:500})}}if(w&&(!p||!m?.trim()))return o.NextResponse.json({error:"Missing existing template or comments for refinement."},{status:400});if(w){var t;t=i.brandName||"Brand",r=`
You are an expert eCommerce copywriter refining a product description template for "${t}".

CURRENT TEMPLATE:
${JSON.stringify(p,null,2)}

USER REVISION NOTES:
${m}

Instructions:
- Apply the user's requested changes carefully and literally. If they ask to remove a field, remove it.
- Add or rename fields exactly as requested.
- Update the exampleProduct to match the revised field list — remove keys for deleted fields, add keys for new ones.
- Keep the same JSON structure.
- Do NOT reintroduce fields the user asked to remove.
- Do NOT include SEO titles, meta descriptions, or any other backend/technical fields — only visible customer-facing copy fields.

${y}
`.trim()}else{let[t,s,a]=await Promise.all([g(n),_(n),fetch(`${process.env.NEXTAUTH_URL||"http://localhost:3000"}/api/user/business-info?databaseId=${encodeURIComponent(n)}`,{headers:{cookie:e.headers.get("cookie")||""}}).then(e=>e.ok?e.json():{}).catch(()=>({}))]),i=a.brandName||"Brand",o=a.brandUrl||"",c=null;if(t?.brandColours)try{let e=JSON.parse(t.brandColours);"object"!=typeof e||Array.isArray(e)||(c=e)}catch{}r=function(e,t,r,s,a){let i=r?`
BRAND PROFILE:
- Mission: ${r.mission}
- Unique Value Proposition: ${r.uvp}
- Brand Tone: ${r.tone}
- Target Demographics: ${r.demographics}
- Geographic Markets: ${r.geo}
- Hero Products: ${r.products}
- Price Positioning: ${r.pricing}
- Customer Praises: ${r.praises}
- Customer Objections: ${r.objections}
- Competitors: ${r.competitors}
- Market Gap / Advantage: ${r.marketGap}
- Logo URL: ${r.logoUrl}
- Shipping Policy: ${r.shippingPolicy}
- Returns Policy: ${r.returnsPolicy}
- Connected Software: ${r.connectedSoftware}
- Operations Summary: ${r.operationsSummary}
- Brand History: ${r.brandHistory}
- Physical Branches: ${r.physicalBranches}
`.trim():"",n=a&&Object.values(a).some(Boolean)?`
BRAND COLOURS (use these in your template where relevant — e.g. reference primary colour for hero callouts, accent for badges):
- Primary: ${a.primary||"not set"}
- Secondary: ${a.secondary||"not set"}
- Accent: ${a.accent||"not set"}
- Neutral: ${a.neutral||"not set"}
- Background: ${a.background||"not set"}
`.trim():"",o=["id","variant_id","handle","title","status","product_type","vendor","tags","description_html","price","compare_at_price","sku","barcode","inventory_qty","weight","image_url","variant_count","image_count","published_at","updated_at"],c=s.length>0?`
SAMPLE PRODUCTS (from Shopify — up to 7 rows):
${s.map(e=>{let t=t=>e[o.indexOf(t)]||"";return`- ${t("title")} | Type: ${t("product_type")} | Price: $${t("price")} | Tags: ${t("tags")}`}).join("\n")}
`.trim():"";return`
You are an expert eCommerce copywriter and product content strategist.
Your task is to build a Product Description Template for the brand "${e}" (${t}).
This template will be used as a content guide — every product on the website will be written following this template.

${i}

${n?n+"\n\n":""}${c}

Based on the brand personality, target customer, price point, and product types above — design a product description template that:
1. Matches the brand voice and tone
2. Is optimised for conversion at this price point
3. Addresses the key customer praises and objections
4. Has clear, structured fields that a non-copywriter could follow
5. Includes only the fields that genuinely add value for this brand/product type

${f}
`.trim()}(i,o,t,s,c)}let E=new l.fA({apiKey:b}),v=await E.models.generateContent({model:S,contents:r}),x=v.text?.trim()??"",A=x.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();try{s=JSON.parse(A)}catch{return console.error("Gemini returned non-JSON:",x.slice(0,200)),o.NextResponse.json({error:"AI returned an unexpected format. Please try again."},{status:500})}return o.NextResponse.json({success:!0,template:s})}catch(e){return console.error("build-product-description error:",e),o.NextResponse.json({error:"Failed to generate product description template."},{status:500})}}let S=new a.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/ai/build-product-schema/route",pathname:"/api/ai/build-product-schema",filename:"route",bundlePath:"app/api/ai/build-product-schema/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/ai/build-product-schema/route.ts",nextConfigOutput:"standalone",userland:s}),{requestAsyncStorage:w,staticGenerationAsyncStorage:E,serverHooks:v}=S,x="/api/ai/build-product-schema/route";function A(){return(0,n.patchFetch)({serverHooks:v,staticGenerationAsyncStorage:E})}},14419:(e,t,r)=>{"use strict";r.d(t,{L2:()=>n,PQ:()=>o,ZI:()=>c,_k:()=>d,_v:()=>p,iV:()=>u});var s=r(35857),a=r(40611),i=r(48576);async function n(e){let t=await s.vg.get(e),r=t?.cin7_account_id??"",a=t?.cin7_api_key??"",n=a?(0,i.p)(a):"";if(!r||!n)throw Error("Cin7 credentials not configured. Save them in Setup → Connections first.");let o=`Basic ${Buffer.from(`${r}:${n}`).toString("base64")}`;return{accountId:r,apiKey:n,authHeader:o}}async function o(e){return await a.I.get(e,"Inventory System")||e}async function c(e,t,r=0,s="cin7"){let a;try{a=await fetch(e,{headers:{Authorization:t,"Content-Type":"application/json"},signal:AbortSignal.timeout(3e4)})}catch(a){if(r>=3)throw Error(`Cin7 network error: ${a.message}`);return await p(3e3*Math.pow(2,r)),c(e,t,r+1,s)}if(429===a.status){if(r>=3)throw Error("Cin7 rate limit exceeded after retries.");return console.log(`[${s}] 429 — waiting 60s before retry...`),await p(6e4),c(e,t,r+1,s)}if(a.status>=500){if(r>=3)throw Error(`Cin7 server error: HTTP ${a.status}`);return await p(2e3*Math.pow(2,r)),c(e,t,r+1,s)}if(!a.ok){let e=await a.text().catch(()=>"");throw Error(`Cin7 error HTTP ${a.status}: ${e.slice(0,200)}`)}return a.json()}let l="https://api.cin7.com/api/v1";async function u(e,t,r={},s="cin7"){let a=[],i=1;for(;;){let n;let o=new URL(`${l}${t}`);for(let[e,t]of(o.searchParams.set("rows",String(250)),o.searchParams.set("page",String(i)),Object.entries(r)))o.searchParams.set(e,t);console.log(`[${s}] GET ${t} page ${i}`);let u=await c(o.toString(),e,0,s);if(Array.isArray(u))n=u;else if(u&&"object"==typeof u){let e=u.data??u.Branches??u.branches??u.records??u.items;n=Array.isArray(e)?e:[]}else n=[];if(0===n.length||(a.push(...n),n.length<250))break;i++,await p(1100)}return a}async function d(e,t,r={},s,a){let i=1,n=0;for(;;){let o;let u=new URL(`${l}${t}`);for(let[e,t]of(u.searchParams.set("rows",String(250)),u.searchParams.set("page",String(i)),Object.entries(r)))u.searchParams.set(e,t);console.log(`[${s}] GET ${t} page ${i}`);let d=await c(u.toString(),e,0,s);if(Array.isArray(d))o=d;else if(d&&"object"==typeof d){let e=d.data??d.Branches??d.branches??d.records??d.items;o=Array.isArray(e)?e:[]}else o=[];if(0===o.length||(await a(o,i),n+=o.length,o.length<250))break;i++,await p(1100)}return n}function p(e){return new Promise(t=>setTimeout(t,e))}},56293:(e,t,r)=>{"use strict";r.d(t,{u:()=>a});var s=r(65037);let a={get:async e=>(await (0,s.IO)("SELECT * FROM brand_profile WHERE business_id = ?",[e]))[0]??null,async upsert(e,t){let r={...t};null!=r.physical_branches&&"string"!=typeof r.physical_branches&&(r.physical_branches=JSON.stringify(r.physical_branches));let a=Object.keys(r);if(0===a.length)return;let i=a.map(e=>`${e} = VALUES(${e})`).join(", "),n=a.map(e=>r[e]??null);await (0,s.ht)(`INSERT INTO brand_profile (business_id, ${a.join(", ")})
       VALUES (?, ${a.map(()=>"?").join(", ")})
       ON DUPLICATE KEY UPDATE ${i}, updated_at = NOW()`,[e,...n])}}},40611:(e,t,r)=>{"use strict";r.d(t,{I:()=>a});var s=r(65037);let a={getAll:async e=>Object.fromEntries((await (0,s.IO)("SELECT `key`, value FROM config WHERE business_id = ?",[e])).map(e=>[e.key,e.value])),async get(e,t){let r=await (0,s.IO)("SELECT value FROM config WHERE business_id = ? AND `key` = ?",[e,t]);return r[0]?.value??null},async set(e,t,r){await (0,s.ht)("INSERT INTO config (business_id, `key`, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = NOW()",[e,t,r])},async delete(e,t){await (0,s.ht)("DELETE FROM config WHERE business_id = ? AND `key` = ?",[e,t])}}},35857:(e,t,r)=>{"use strict";r.d(t,{m2:()=>i,vg:()=>n});var s=r(65037);let a={Cin7AccountId:"cin7_account_id",Cin7ApiKey:"cin7_api_key",ShopifyShopId:"shopify_shop_id",ShopifyAccessToken:"shopify_access_token",MetaAdAccountId:"meta_ad_account_id",MetaAccessToken:"meta_access_token",GoogleAdsCustomerId:"google_ads_customer_id",GoogleAdsRefreshToken:"google_ads_refresh_token",KlaviyoApiKey:"klaviyo_api_key",GmailAddress:"gmail_email",GmailRefreshToken:"gmail_refresh_token",WebsiteSheetId:"website_sheet_id",GA4PropertyId:"ga4_property_id",GeminiModel:"gemini_model",XeroTenantId:"xero_tenant_id",XeroTenantName:"xero_tenant_name",XeroTokenExpiry:"xero_token_expiry"},i=new Set(["ShopifyAccessToken","MetaAccessToken","Cin7ApiKey","GmailRefreshToken","KlaviyoApiKey","GoogleAdsRefreshToken"]),n={get:async e=>(await (0,s.IO)("SELECT * FROM connections WHERE business_id = ?",[e]))[0]??null,async saveFromLegacy(e,t){let r={};for(let[e,s]of Object.entries(t)){let t=a[e];t&&(r[t]=s||null)}await n.upsert(e,r)},async getLegacy(e){let t=await n.get(e);if(!t)return{};let r={};for(let[e,s]of Object.entries(a))r[e]=t[s]??"";return r},async upsert(e,t){let r=Object.keys(t);if(0===r.length)return;let a=r.map(e=>`${e} = VALUES(${e})`).join(", "),i=r.map(e=>t[e]??null);await (0,s.ht)(`INSERT INTO connections (business_id, ${r.join(", ")})
       VALUES (?, ${r.map(()=>"?").join(", ")})
       ON DUPLICATE KEY UPDATE ${a}, updated_at = NOW()`,[e,...i])}}},23237:(e,t,r)=>{"use strict";r.d(t,{g:()=>a,o:()=>i});var s=r(65037);let a={list:async e=>(0,s.IO)("SELECT * FROM products WHERE business_id = ?",[e]),async updateVolume(e,t,r){await execute("UPDATE products SET volume = ? WHERE business_id = ? AND option_id = ?",[Math.min(10,Math.max(1,Math.round(r))),e,t])},async upsertBatch(e,t){if(0===t.length)return;let r=await (0,s.Mj)().getConnection();try{for(let s of(await r.beginTransaction(),t))await r.execute(`INSERT INTO products
             (business_id, cin7_id, option_id, code, style_code, barcode, name, brand,
              supplier_id, option_label, online, pack_size, cost, retail_price, volume,
              created_date, last_synced_at, global_soh, global_available, global_incoming,
              sales_qty_7d, sales_qty_90d, sales_qty_180d, sales_qty_12m,
              sales_revenue_7d, sales_revenue_90d, sales_revenue_180d, sales_revenue_12m)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             cin7_id=VALUES(cin7_id), code=VALUES(code), style_code=VALUES(style_code),
             barcode=VALUES(barcode), name=VALUES(name), brand=VALUES(brand),
             supplier_id=VALUES(supplier_id), option_label=VALUES(option_label),
             online=VALUES(online), pack_size=VALUES(pack_size), cost=VALUES(cost),
             retail_price=VALUES(retail_price), volume=VALUES(volume),
             created_date=VALUES(created_date), last_synced_at=VALUES(last_synced_at),
             global_soh=VALUES(global_soh), global_available=VALUES(global_available),
             global_incoming=VALUES(global_incoming),
             sales_qty_7d=VALUES(sales_qty_7d), sales_qty_90d=VALUES(sales_qty_90d),
             sales_qty_180d=VALUES(sales_qty_180d), sales_qty_12m=VALUES(sales_qty_12m),
             sales_revenue_7d=VALUES(sales_revenue_7d), sales_revenue_90d=VALUES(sales_revenue_90d),
             sales_revenue_180d=VALUES(sales_revenue_180d), sales_revenue_12m=VALUES(sales_revenue_12m)`,[e,s.cin7_id,s.option_id,s.code??null,s.style_code??null,s.barcode??null,s.name??null,s.brand??null,s.supplier_id??null,s.option_label??null,s.online??null,s.pack_size??null,s.cost??null,s.retail_price??null,s.volume??null,s.created_date??null,s.last_synced_at??null,s.global_soh,s.global_available,s.global_incoming,s.sales_qty_7d,s.sales_qty_90d,s.sales_qty_180d,s.sales_qty_12m,s.sales_revenue_7d,s.sales_revenue_90d,s.sales_revenue_180d,s.sales_revenue_12m]);await r.commit()}catch(e){throw await r.rollback(),e}finally{r.release()}}},i={list:async e=>(0,s.IO)("SELECT * FROM stock WHERE business_id = ?",[e]),async bulkReplace(e,t){let r=await (0,s.Mj)().getConnection();try{for(let s of(await r.beginTransaction(),await r.execute("DELETE FROM stock WHERE business_id = ?",[e]),t))await r.execute(`INSERT INTO stock
             (business_id, product_option_id, branch_id, branch_name, code, name,
              soh, available, incoming, reorder_point, reorder_qty, last_synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             branch_name=VALUES(branch_name), code=VALUES(code), name=VALUES(name),
             soh=VALUES(soh), available=VALUES(available), incoming=VALUES(incoming),
             reorder_point=VALUES(reorder_point), reorder_qty=VALUES(reorder_qty),
             last_synced_at=VALUES(last_synced_at)`,[e,s.product_option_id,s.branch_id??null,s.branch_name??null,s.code??null,s.name??null,s.soh,s.available,s.incoming,s.reorder_point??null,s.reorder_qty??null,s.last_synced_at??null]);await r.commit()}catch(e){throw await r.rollback(),e}finally{r.release()}}}},48576:(e,t,r)=>{"use strict";r.d(t,{H:()=>n,p:()=>o});var s=r(84770);let a="aes-256-gcm";function i(){let e=process.env.ENCRYPTION_KEY;if(!e||64!==e.length)throw Error("ENCRYPTION_KEY must be a 64-character hex string in .env");return Buffer.from(e,"hex")}function n(e){if(!e)return"";let t=i(),r=(0,s.randomBytes)(12),n=(0,s.createCipheriv)(a,t,r),o=Buffer.concat([n.update(e,"utf8"),n.final()]),c=n.getAuthTag();return`${r.toString("hex")}:${c.toString("hex")}:${o.toString("hex")}`}function o(e){if(!e)return"";if(!function(e){let t=e.split(":");if(3!==t.length)return!1;let[r,s]=t;return 24===r.length&&32===s.length&&/^[0-9a-f]+$/i.test(r)&&/^[0-9a-f]+$/i.test(s)}(e))return e;let[t,r,n]=e.split(":"),o=i(),c=(0,s.createDecipheriv)(a,o,Buffer.from(t,"hex"));return c.setAuthTag(Buffer.from(r,"hex")),Buffer.concat([c.update(Buffer.from(n,"hex")),c.final()]).toString("utf8")}},65037:(e,t,r)=>{"use strict";r.d(t,{IO:()=>n,Mj:()=>i,ht:()=>o});var s=r(73785);let a=null;function i(){return a||(a=s.createPool({host:process.env.MYSQL_HOST??"localhost",port:parseInt(process.env.MYSQL_PORT??"3306",10),database:process.env.MYSQL_DATABASE??"",user:process.env.MYSQL_USER??"",password:process.env.MYSQL_PASSWORD??"",waitForConnections:!0,connectionLimit:5,queueLimit:0,timezone:"Z",charset:"utf8mb4"})),a}async function n(e,t){let[r]=await i().execute(e,t);return r}async function o(e,t){let[r]=await i().execute(e,t);return r}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[8948,1615,5972,3785,1441,6684,5453,7816,8954,3203],()=>r(75668));module.exports=s})();