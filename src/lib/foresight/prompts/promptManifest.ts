import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ForesightPromptId = 'strategy-interviewer' | 'initiative-planner' | 'planner-dialogue';

const PROMPTS: Record<ForesightPromptId, { version: string; filename: string }> = {
  'strategy-interviewer': { version: 'strategy-interviewer-v1', filename: 'strategy-interviewer-v1.md' },
  'initiative-planner': { version: 'initiative-planner-v1', filename: 'initiative-planner-v1.md' },
  'planner-dialogue': { version: 'planner-dialogue-v1', filename: 'planner-dialogue-v1.md' },
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