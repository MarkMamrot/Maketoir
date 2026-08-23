import 'dotenv/config';

import { runAssistant } from '../src/lib/assistant/orchestrator';

async function main() {
  const principal = { audience: 'ims' as const, businessId: 'validation', userId: 1, tier: 'Admin' as const };
  const questions = [
    'What kind of inventory cost system does Solvantis use?',
    'Can I make purchase orders in Solvantis?',
    'Where is the purchase order screen?',
  ];
  for (const question of questions) {
    const result = await runAssistant({ principal, message: question, currentView: 'dashboard' });
    console.log(JSON.stringify({ question, answer: result.answer, citations: result.citations }));
  }
}

void main();