"use strict";(()=>{var e={};e.id=6379,e.ids=[6379],e.modules={72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},32694:e=>{e.exports=require("http2")},35240:e=>{e.exports=require("https")},98216:e=>{e.exports=require("net")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},35816:e=>{e.exports=require("process")},68621:e=>{e.exports=require("punycode")},86624:e=>{e.exports=require("querystring")},76162:e=>{e.exports=require("stream")},82452:e=>{e.exports=require("tls")},74175:e=>{e.exports=require("tty")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},15673:e=>{e.exports=require("node:events")},97742:e=>{e.exports=require("node:process")},47261:e=>{e.exports=require("node:util")},517:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>S,patchFetch:()=>$,requestAsyncStorage:()=>y,routeModule:()=>f,serverHooks:()=>T,staticGenerationAsyncStorage:()=>x});var i={};r.r(i),r.d(i,{POST:()=>h});var n=r(49303),s=r(88716),a=r(60670),o=r(87070),l=r(71615),c=r(33203);let p=`You are an expert e-commerce product content writer specialising in retail apparel and accessories. You use web search to research specific products and write accurate, engaging, SEO-optimised content for Shopify stores. Always respond with valid JSON only — no markdown code blocks, no preamble.`;async function u(e,t){try{let r=await e.getData(t,"BrandProfile!A:U");if(!r||r.length<2)return"";let i=r[1];return[[1,"Brand Mission"],[2,"Unique Value Proposition"],[3,"Brand Tone & Voice"],[4,"Target Demographics"],[5,"Top Geographies"],[6,"Hero Products"],[7,"Price Positioning"],[16,"Business Operations"],[18,"Brand History"]].filter(([e])=>i[e]?.trim()).map(([e,t])=>`${t}: ${i[e].trim()}`).join("\n")}catch{return""}}async function d(e,t){try{let r=await e.getData(t,"BusinessInfo!A:G");if(!r||r.length<2)return"";let i=r[1];return`Brand Name: ${i[1]||"N/A"}
Website: ${i[2]||"N/A"}`}catch{return""}}async function g(e,t){let r={description:null,title:null,tags:null};try{let i=await e.getData(t,"Config!A:B"),n=i?.find(e=>"WebsiteSheetId"===e[0])?.[1];if(!n)return r;let s=await e.getData(n,"ProductDescTemplate");if(!s||s.length<2)return r;let a=s[0];if(a[0]?.trim()==="Timestamp"){let e=s[1]?.[1]?.trim();if(e)try{return{...r,description:JSON.parse(e)}}catch{}return r}let o={description:null,title:null,tags:null};for(let e of s.slice(1)){let t=e[0]?.trim(),r=e[1]?.trim();if(t&&["description","title","tags"].includes(t)&&r)try{o[t]=JSON.parse(r)}catch{o[t]=r}}return o}catch{return r}}function m(e){let t=[],r=e?.headingTag,i=e?.headingColour,n=e?.bulletChar,s=e?.bulletColour;if(r||i){let e=r??"h3",n=i?` style="color:${i};"`:"";t.push(`- Section headings: always use <${e}${n}>Heading Text</${e}> — apply exactly on every heading, no deviations.`)}if(s||n){let e=n??"✓";if(s){let r=`<ul style="list-style:none;padding:0;margin:0 0 14px 0;"><li style="display:flex;gap:8px;align-items:flex-start;margin-bottom:6px;"><span style="color:${s};font-weight:bold;flex-shrink:0;">${e}</span><span>Item text here</span></li></ul>`;t.push(`- Bullet lists: use this exact pattern (never plain <ul><li>):
  ${r}`)}else t.push(`- Every list item MUST start with "${e}" — e.g. <li>${e} Feature text here</li>`);t.push("- No CSS classes. Inline styles only as shown above.")}return t.length>0?`
HTML GENERATION RULES (mandatory — follow exactly, no deviations):
${t.join("\n")}`:""}async function h(e){try{let t;let r=(0,l.cookies)().get("marketoir_session");if(!r?.value)return o.NextResponse.json({error:"Not authenticated."},{status:401});let{databaseId:i,product:n,mode:s="full",field:a,currentContent:h,userNote:f="",tavilyInfo:y="",tavilyUrls:x=[],userPhotos:T=[],userNotes:S=""}=await e.json();if(!i||!n)return o.NextResponse.json({error:"Missing databaseId or product"},{status:400});let $=process.env.GEMINI_API_KEY??process.env.GOOGLE_AI_API_KEY;if(!$)return o.NextResponse.json({error:"GEMINI_API_KEY not configured."},{status:500});let E=new c.GoogleSheetsService,[N,b,w]=await Promise.all([u(E,i),d(E,i),g(E,i)]),O="gemini-2.5-flash";try{let e=await E.getData(i,"Connections");if(e?.length>=2){let t=e[0],r=e[1][t.indexOf("GeminiModel")];r?.trim()&&(O=r.trim())}}catch{}let R=!1;if("reformulate"===s&&a){let e="images"===a?JSON.stringify(h?.images??[]):String(h?.[a]??"");t=function(e,t,r,i,n,s){let a="";if("title"===r&&s.title)a=`
TITLE TEMPLATE:
${JSON.stringify(s.title,null,2)}`;else if("websiteDescription"===r&&s.description){let e=m(s.description);a=`
DESCRIPTION TEMPLATE:
${JSON.stringify(s.description,null,2)}${e}`}else"tags"===r&&s.tags?a=`
TAGS TEMPLATE:
${JSON.stringify(s.tags,null,2)}`:"cin7Description"===r?a="\nREQUIREMENT: Plain text, strictly under 220 characters. No HTML.":"images"===r&&(a='\nREQUIREMENT: Please provide a list of up to 5 official product page URLs you found in order of preference. Return JSON with {"productUrls": ["https://..."]}. Do not guess image URLs; the system will scrape the pages you provide.');let o=n?.trim()?`
USER NOTE: ${n.trim()}`:"";return`Improve one specific content field for a product listing.

PRODUCT: ${e.name} by ${e.brand} (SKU: ${e.code})

BRAND CONTEXT:
${t||"No brand profile."}
${a}
FIELD TO IMPROVE: ${r}
CURRENT VALUE: ${i}
${o}

Rewrite this field to be better. Follow all template rules.${"images"===r?" Use Google Search to find better images.":""}

Return ONLY this JSON (no markdown):
{ "${r}": <new value> }`}(n,N,a,e,f,w),R="images"===a}else t=function(e,t,r,i,n=[],s=""){let a=i.title?`
TITLE TEMPLATE:
${JSON.stringify(i.title,null,2)}`:"\nTITLE TEMPLATE:\nCreate a clear, descriptive product title including brand name, product type, and key features.",o=m(i.description),l=i.description?`
DESCRIPTION TEMPLATE:
${JSON.stringify(i.description,null,2)}${o}`:"\nDESCRIPTION TEMPLATE:\nWrite a compelling HTML product description with key features and benefits.",c=i.tags?`
TAGS TEMPLATE:
${JSON.stringify(i.tags,null,2)}`:"\nTAGS TEMPLATE:\nGenerate relevant SEO tags as a comma-separated list.",p=s?`
PRODUCT RESEARCH (sourced via Tavily Search):
${s}`:"",u=n.length>0?`
VERIFIED PRODUCT PAGE URLs:
${n.map((e,t)=>`${t+1}. ${e}`).join("\n")}`:"",d=s?`Using ONLY the product research and URLs provided above, generate all content fields for "${e.name}" by ${e.brand}. Do not search the web — all information needed is in the research block above.`:`Research "${e.name}" by ${e.brand} using the verified URLs above (or by web search if none provided), then generate all content fields.`;return`Generate complete website content for this specific product.

BUSINESS INFO:
${r}

BRAND CONTEXT:
${t||"No brand profile configured."}
${a}
${l}
${c}

PRODUCT:
- Product Name: ${e.name}
- Brand: ${e.brand}
- SKU/Code: ${e.code}
- Style Code: ${e.styleCode}
- Retail Price: $${e.retailPrice}
${p}${u}

TASK:
1. ${d}
2. Generate all content fields strictly following the templates above.

Return ONLY the following JSON (no markdown, no explanation):
{
  "title": "product title per title template",
  "websiteDescription": "full HTML description per description template",
  "tags": "comma-separated tags per tags template",
  "cin7Description": "short plain-text internal description, strictly under 220 characters",
  "images": [],
  "cin7Online": "-4",
  "cin7Channels": "Shopify https://monsterthreads.myshopify.com/"
}

For images: Leave the images array empty. The system will scrape the product page URLs separately.`}(n,N,b,w,[],y);S?.trim()&&(t+=`

ADDITIONAL NOTES FROM USER:
${S.trim()}`);let P=[{text:t}];for(let e of T){if(!e?.startsWith("data:"))continue;let[t,r]=e.split(","),i=t.match(/data:([^;]+)/)?.[1]??"image/jpeg";P.push({inline_data:{mime_type:i,data:r}})}let v={contents:[{role:"user",parts:P}],systemInstruction:{parts:[{text:p}]}};R&&(v.tools=[{google_search:{}}]);let A=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${O}:generateContent?key=${$}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(v),signal:AbortSignal.timeout(12e4)});if(!A.ok){let e=await A.text();return o.NextResponse.json({error:`Gemini API error (HTTP ${A.status}): ${e.slice(0,300)}`},{status:502})}let I=await A.json(),q=(I.candidates?.[0]?.content?.parts?.[0]?.text??"").trim();if(!q)return o.NextResponse.json({error:"AI returned empty response."},{status:500});let L=function(e){let t=e.replace(/^```(?:json)?\n?/,"").replace(/\n?```$/,"").trim();try{return JSON.parse(t)}catch{}let r=t.match(/\{[\s\S]*\}/);if(r)try{return JSON.parse(r[0])}catch{}return null}(q);if(!L)return o.NextResponse.json({error:"AI response could not be parsed as JSON.",raw:q.slice(0,500)},{status:500});if("reformulate"===s&&a)return o.NextResponse.json({success:!0,field:a,value:L[a],raw:L});let D=(Array.isArray(L.images)?L.images:[]).map(String).filter(e=>e.startsWith("http")),C={title:String(L.title??""),websiteDescription:String(L.websiteDescription??""),tags:String(L.tags??""),cin7Description:String(L.cin7Description??"").slice(0,220),images:D.slice(0,10),cin7Online:String(L.cin7Online??"-4"),cin7Channels:String(L.cin7Channels??"")};for(;C.images.length<10;)C.images.push("");return o.NextResponse.json({success:!0,content:C})}catch(e){return console.error("[generate-content]",e),o.NextResponse.json({error:e.message??"Internal server error"},{status:500})}}let f=new n.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/website/generate-content/route",pathname:"/api/website/generate-content",filename:"route",bundlePath:"app/api/website/generate-content/route"},resolvedPagePath:"/home/runner/work/Maketoir/Maketoir/src/app/api/website/generate-content/route.ts",nextConfigOutput:"standalone",userland:i}),{requestAsyncStorage:y,staticGenerationAsyncStorage:x,serverHooks:T}=f,S="/api/website/generate-content/route";function $(){return(0,a.patchFetch)({serverHooks:T,staticGenerationAsyncStorage:x})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[8948,1615,5972,1441,6684,5453,7816,3203],()=>r(517));module.exports=i})();