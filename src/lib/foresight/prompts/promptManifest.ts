import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ForesightPromptId = 'strategy-interviewer' | 'initiative-planner' | 'planner-dialogue' | 'campaign-deliverables' | 'campaign-learning' | 'campaign-experiment';

const PROMPTS: Record<ForesightPromptId, { version: string; filename: string }> = {
  'strategy-interviewer': { version: 'strategy-interviewer-v1', filename: 'strategy-interviewer-v1.md' },
  'initiative-planner': { version: 'initiative-planner-v1', filename: 'initiative-planner-v1.md' },
  'planner-dialogue': { version: 'planner-dialogue-v2', filename: 'planner-dialogue-v2.md' },
  'campaign-deliverables': { version: 'campaign-deliverables-v1', filename: 'campaign-deliverables-v1.md' },
  'campaign-learning': { version: 'campaign-learning-v1', filename: 'campaign-learning-v1.md' },
  'campaign-experiment': { version: 'campaign-experiment-v2', filename: 'campaign-experiment-v2.md' },
};

export interface LoadedForesightPrompt {
  id: ForesightPromptId;
  version: string;
  content: string;
  sha256: string;
}

export async function loadForesightPrompt(id: ForesightPromptId): Promise<LoadedForesightPrompt> {
  const manifest = PROMPTS[id];
  const filePath = path.join(process.cwd(), 'src', 'lib', 'foresight', 'prompts', manifest.filename);
  const content = await fs.readFile(filePath, 'utf8');
  return {
    id,
    version: manifest.version,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export function listForesightPrompts(): Array<{ id: ForesightPromptId; version: string }> {
  return Object.entries(PROMPTS).map(([id, prompt]) => ({
    id: id as ForesightPromptId,
    version: prompt.version,
  }));
}