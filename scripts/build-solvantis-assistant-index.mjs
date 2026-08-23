import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsDirectory = path.join(root, 'docs', 'assistant');
const capabilityPath = path.join(root, 'src', 'lib', 'assistant', 'capabilities.json');
const outputDirectory = path.join(root, 'src', 'generated');
const outputPath = path.join(outputDirectory, 'solvantis-assistant-index.json');
const validAudiences = new Set(['ims', 'pos', 'wholesale']);

function parseDocument(filename, source) {
  const match = source.match(/^---\r?\n([^\n]+)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: expected single-line JSON frontmatter`);
  const metadata = JSON.parse(match[1]);
  for (const field of ['id', 'title', 'capability', 'screen', 'lastReviewed', 'owner']) {
    if (!String(metadata[field] ?? '').trim()) throw new Error(`${filename}: missing ${field}`);
  }
  if (!Array.isArray(metadata.audiences) || metadata.audiences.some(value => !validAudiences.has(value))) {
    throw new Error(`${filename}: invalid audiences`);
  }

  const sections = [];
  let heading = metadata.title;
  let body = [];
  const flush = () => {
    const content = body.join('\n').trim();
    if (!content) return;
    sections.push({
      id: `${metadata.id}:${sections.length + 1}`,
      documentId: metadata.id,
      title: metadata.title,
      heading,
      audiences: metadata.audiences,
      capability: metadata.capability,
      screen: metadata.screen,
      lastReviewed: metadata.lastReviewed,
      content,
    });
  };
  for (const line of match[2].split(/\r?\n/)) {
    if (line.startsWith('# ')) continue;
    if (line.startsWith('## ')) {
      flush();
      heading = line.slice(3).trim();
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return { metadata, sections };
}

const filenames = (await fs.readdir(docsDirectory)).filter(filename => filename.endsWith('.md')).sort();
const documents = [];
const chunks = [];
const ids = new Set();
for (const filename of filenames) {
  const parsed = parseDocument(filename, await fs.readFile(path.join(docsDirectory, filename), 'utf8'));
  if (ids.has(parsed.metadata.id)) throw new Error(`Duplicate assistant document id: ${parsed.metadata.id}`);
  ids.add(parsed.metadata.id);
  documents.push({ ...parsed.metadata, filename });
  chunks.push(...parsed.sections);
}

const capabilities = JSON.parse(await fs.readFile(capabilityPath, 'utf8'));
const capabilityIds = new Set(capabilities.map(capability => capability.id));
for (const document of documents) {
  if (!capabilityIds.has(document.capability)) {
    throw new Error(`${document.filename}: unknown capability ${document.capability}`);
  }
}

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ version: 1, documents, capabilities, chunks }, null, 2)}\n`);
console.log(`Built private Solvantis assistant index with ${documents.length} documents and ${chunks.length} chunks.`);