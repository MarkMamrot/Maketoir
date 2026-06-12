import 'dotenv/config'; 
import { GoogleGenAI } from '@google/genai';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY });
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Search Google for "Jellycat Bashful Bunny Beige". Return the top 5 EXACT URLs from the search results as a JSON array of strings.',
  tools: [{ googleSearch: {} }],
});
console.log('Result:', response.text);
