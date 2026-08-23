import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadAssistantPrompt() {
  const version = 'assistant-v1';
  const content = await fs.readFile(path.join(process.cwd(), 'src', 'lib', 'assistant', 'prompts', `${version}.md`), 'utf8');
  return { version, content, sha256: createHash('sha256').update(content).digest('hex') };
}