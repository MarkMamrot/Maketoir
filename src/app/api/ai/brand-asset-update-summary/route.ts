/**
 * POST /api/ai/brand-asset-update-summary
 *
 * Fire-and-forget endpoint called when the AI creative panel closes.
 * Appends conversation to pending_buffer. When the buffer reaches ~500 words,
 * runs gemini-2.5-flash to rewrite the Creative Intelligence Brief and clears
 * the buffer. Otherwise just stores the buffer — no Gemini call, no cost.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { GoogleGenAI } from '@google/genai';
import { query, execute } from '@/services/MySQLService';

const PENDING_THRESHOLD = 500; // words before we summarise
const SYSTEM_PROMPT = `You are a creative knowledge curator for a fashion/lifestyle retail brand's visual content team.

Your job is to maintain a concise "Creative Intelligence Brief" — a living reference document that captures:
• Model preferences: age range, look, styling, expressions, poses that work for this brand
• Backdrop and setting preferences: environments, lighting, mood, recurring locations
• Style and visual mood patterns that resonate with the brand
• Prompt structures and phrasings that produce good results with AI image generators
• Explicit creative decisions made (e.g. "always use soft diffused light", "avoid busy backgrounds")
• Things that don't work or should be avoided for this brand

You receive the EXISTING brief (may be empty) and NEW conversation text from recent creative sessions.

Rules:
- Update the brief to incorporate genuinely useful new learnings
- Remove or correct information that is contradicted or superseded by the new conversations
- Ignore small talk, technical errors, or off-topic exchanges
- If nothing in the conversations is worth adding to the brief, respond with exactly: DISCARD
- Max 600 words. Be specific and actionable, not generic.
- Write in plain text, using bullet points or short paragraphs.

Return ONLY the updated brief text (or DISCARD). No preamble, no explanation.`;

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function conversationToText(msgs: { role: string; text: string }[]): string {
  return msgs
    .map(m => `[${m.role === 'user' ? 'User' : 'AI'}]: ${m.text.trim()}`)
    .join('\n\n');
}

export async function POST(req: Request) {
  const sessionCookie = cookies().get('marketoir_session');
  if (!sessionCookie?.value) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });

  const { databaseId, conversation } = await req.json();
  if (!databaseId || !Array.isArray(conversation) || conversation.length < 2) {
    return NextResponse.json({ queued: false, reason: 'insufficient data' });
  }

  // ── 1. Build new conversation text ─────────────────────────────────────────
  const newText = conversationToText(conversation);

  // ── 2. Fetch existing row ───────────────────────────────────────────────────
  const rows = await query<{ summary: string | null; pending_buffer: string | null }>(
    'SELECT summary, pending_buffer FROM creative_summaries WHERE business_id = ?',
    [databaseId],
  );
  const existing = rows[0] ?? { summary: '', pending_buffer: '' };
  const currentSummary  = existing.summary        ?? '';
  const currentBuffer   = existing.pending_buffer ?? '';

  // ── 3. Append to buffer ─────────────────────────────────────────────────────
  const updatedBuffer  = (currentBuffer + '\n\n---\n\n' + newText).trim();
  const bufferWords    = wordCount(updatedBuffer);

  // ── 4. Not enough yet — just store and return ───────────────────────────────
  if (bufferWords < PENDING_THRESHOLD) {
    await execute(
      `INSERT INTO creative_summaries (business_id, summary, pending_buffer)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE pending_buffer = VALUES(pending_buffer), updated_at = NOW()`,
      [databaseId, currentSummary, updatedBuffer],
    );
    return NextResponse.json({ queued: true, pendingWords: bufferWords, threshold: PENDING_THRESHOLD });
  }

  // ── 5. Threshold reached — run Gemini summariser ────────────────────────────
  const userPrompt = [
    currentSummary
      ? `EXISTING BRIEF:\n${currentSummary}`
      : 'EXISTING BRIEF:\n(none yet — this is the first session)',
    `NEW CONVERSATIONS:\n${updatedBuffer}`,
  ].join('\n\n---\n\n');

  try {
    const ai     = new GoogleGenAI({ apiKey });
    const result = await (ai as any).models.generateContent({
      model:             'gemini-2.5-flash',
      systemInstruction: SYSTEM_PROMPT,
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });

    const raw = (result.text ?? '').trim();

    if (raw === 'DISCARD' || !raw) {
      // Nothing useful — clear the buffer but keep summary unchanged
      await execute(
        `INSERT INTO creative_summaries (business_id, summary, pending_buffer)
         VALUES (?, ?, '')
         ON DUPLICATE KEY UPDATE pending_buffer = '', updated_at = NOW()`,
        [databaseId, currentSummary],
      );
      return NextResponse.json({ updated: false, reason: 'discarded by AI' });
    }

    // Update summary and clear buffer
    await execute(
      `INSERT INTO creative_summaries (business_id, summary, pending_buffer)
       VALUES (?, ?, '')
       ON DUPLICATE KEY UPDATE summary = VALUES(summary), pending_buffer = '', updated_at = NOW()`,
      [databaseId, raw],
    );
    return NextResponse.json({ updated: true, summaryWords: wordCount(raw) });

  } catch (e: any) {
    // On error: save the buffer so we don't lose it, but don't crash
    await execute(
      `INSERT INTO creative_summaries (business_id, summary, pending_buffer)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE pending_buffer = VALUES(pending_buffer)`,
      [databaseId, currentSummary, updatedBuffer],
    );
    console.error('[brand-asset-update-summary]', e?.message);
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
