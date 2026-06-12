import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${apiKey}`;

const body = {
  contents: [{ role: 'user', parts: [{ text: 'Find the official product page and top major retailer listings for "Palm Pals Kangaroo Soft Toy - 13cm" by Aurora World. I need accurate URLs to specific product pages. List up to 6 page URLs.' }] }],
  tools: [{ google_search: {} }],
};

const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = await res.json();
const chunks = json.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

console.log(`\nFound ${chunks.length} grounding chunks:\n`);
for (const c of chunks) {
  console.log(' title:', c.web?.title);
  console.log('   uri:', c.web?.uri?.slice(0, 80) + '...');
  console.log();
}
