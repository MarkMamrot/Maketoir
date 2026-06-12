import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { ChatsRepository } from '@/lib/db/ChatsRepository';

interface ChatItem {
  role: 'user' | 'assistant';
  content: string;
}

interface SummaryPayload {
  briefSummary: string;
  inventoryManagement: boolean;
  marketing: boolean;
  businessStrategy: boolean;
  websiteManagement: boolean;
}

const SUMMARY_PROMPT = `You are summarizing a business advisory chat for future AI retrieval.
Return STRICT JSON only (no markdown), matching this exact schema:
{
  "briefSummary": "string (max 280 chars)",
  "inventoryManagement": true|false,
  "marketing": true|false,
  "businessStrategy": true|false,
  "websiteManagement": true|false
}

Summary rules:
- Write 2-3 sentences maximum. Be ruthlessly concise.
- Capture: (1) any key analytical findings the AI surfaced, (2) the user's reaction or stance, (3) the conclusion or next action agreed.
- Omit pleasantries, filler, and the back-and-forth. Only the signal.
- Use plain language.
- If no clear finding or conclusion, summarise the main topic and any open question.

Classification rule:
- Set a field to true only when the discussion is materially about that topic.
- Multiple fields can be true.
- If uncertain, use false.`;

function normalizeHistory(raw: any): ChatItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content.trim() }))
    .filter((m: any) => m.content.length > 0);
}

function parseJsonResponse(text: string): SummaryPayload {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); } catch { return { briefSummary: '', inventoryManagement: false, marketing: false, businessStrategy: false, websiteManagement: false }; }
}

export async function POST(req: Request) {
  const session = cookies().get('marketoir_session');
  if (!session?.value) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured.' }, { status: 500 });

  const { databaseId, history } = await req.json();
  if (!databaseId) return NextResponse.json({ error: 'databaseId is required.' }, { status: 400 });

  const chat = normalizeHistory(history);
  if (chat.length < 2) {
    return NextResponse.json({ error: 'Chat history is too short to summarize.' }, { status: 400 });
  }

  const transcript = chat
    .map(m => `${m.role === 'assistant' ? 'Professor KnowItAll' : 'The Business'}: ${m.content}`)
    .join('\n');

  const ai = new GoogleGenAI({ apiKey: geminiKey });
  let summary: SummaryPayload;
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-04-17',
      contents: `${SUMMARY_PROMPT}\n\nCHAT TRANSCRIPT:\n${transcript}`,
    });
    summary = parseJsonResponse(result.text?.trim() ?? '{}');
    if (!summary.briefSummary) throw new Error('Summary was empty');
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to summarize chat: ${e.message}` }, { status: 500 });
  }

  try {
    await ChatsRepository.append(databaseId, {
      role: 'system',
      content: summary.briefSummary,
      context_json: {
        type: 'summary',
        inventoryManagement: summary.inventoryManagement,
        marketing: summary.marketing,
        businessStrategy: summary.businessStrategy,
        websiteManagement: summary.websiteManagement,
        messageCount: chat.length,
      },
    });

    return NextResponse.json({
      success: true,
      summary,
      message: 'Chat summary saved.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Failed to save summary: ${e.message}` }, { status: 500 });
  }
}
