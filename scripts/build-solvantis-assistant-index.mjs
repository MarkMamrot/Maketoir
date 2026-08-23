import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const helpDirectory = path.join(root, 'docs', 'help');
const capabilityPath = path.join(root, 'src', 'lib', 'assistant', 'capabilities.json');
const outputDirectory = path.join(root, 'src', 'generated');
const outputPath = path.join(outputDirectory, 'solvantis-assistant-index.json');
const helpOutputPath = path.join(outputDirectory, 'solvantis-help-index.json');
const validAudiences = new Set(['ims', 'pos', 'wholesale']);
const unsafeHelpPatterns = [
  /\b(?:MYSQL|IMS_MYSQL|AUTH_SESSION|RESEND_API|GEMINI_API)_[A-Z0-9_]*\b/,
  /\breadyedu_[A-Za-z0-9_]+\b/,
  /(?:^|[\s(])(?:src|scripts|e2e)\/[A-Za-z0-9_./[\]-]+/i,
  /\/api\/[A-Za-z0-9_./[\]-]+/i,
  /\b(?:CREATE|ALTER|DROP)\s+TABLE\b|\bSELECT\s+.+\s+FROM\b|\bINSERT\s+INTO\b|\bUPDATE\s+[A-Za-z_][A-Za-z0-9_]*\s+SET\b|\bDELETE\s+FROM\b/i,
];

function parseDocument(filename, source, options = {}) {
  const match = source.match(/^---\r?\n([^\n]+)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${filename}: expected single-line JSON frontmatter`);
  const metadata = JSON.parse(match[1]);
  for (const field of ['id', 'title', 'capability', 'screen', 'lastReviewed', 'owner']) {
    if (!String(metadata[field] ?? '').trim()) throw new Error(`${filename}: missing ${field}`);
  }
  if (!Array.isArray(metadata.audiences) || metadata.audiences.some(value => !validAudiences.has(value))) {
    throw new Error(`${filename}: invalid audiences`);
  }
  if (options.help) {
    for (const field of ['product', 'summary']) {
      if (!String(metadata[field] ?? '').trim()) throw new Error(`${filename}: missing ${field}`);
    }
    if (!Array.isArray(metadata.contexts) || metadata.contexts.length === 0 || metadata.contexts.some(value => !String(value).trim())) {
      throw new Error(`${filename}: invalid contexts`);
    }
    const unsafe = unsafeHelpPatterns.find(pattern => pattern.test(match[2]));
    if (unsafe) throw new Error(`${filename}: contains forbidden internal or sensitive content (${unsafe})`);
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
      topicId: options.help ? metadata.id : undefined,
      contexts: options.help ? metadata.contexts : undefined,
      sourcePriority: options.help ? 6 : undefined,
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
  if (options.help) {
    const headings = new Set(sections.map(section => section.heading.toLowerCase()));
    for (const required of ['Main operations', 'Worked examples']) {
      if (!headings.has(required.toLowerCase())) throw new Error(`${filename}: missing required section ${required}`);
    }
  }
  return { metadata, sections, source: match[2].trim() };
}

async function markdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(entryPath));
    else if (entry.name.endsWith('.md')) files.push(entryPath);
  }
  return files.sort();
}

const documents = [];
const chunks = [];
const helpTopics = [];
const ids = new Set();
const capabilities = JSON.parse(await fs.readFile(capabilityPath, 'utf8'));
for (const helpPath of await markdownFiles(helpDirectory)) {
  const relativePath = path.relative(root, helpPath).replaceAll('\\', '/');
  const parsed = parseDocument(relativePath, await fs.readFile(helpPath, 'utf8'), { help: true });
  if (ids.has(parsed.metadata.id)) throw new Error(`Duplicate help document id: ${parsed.metadata.id}`);
  ids.add(parsed.metadata.id);
  documents.push({ ...parsed.metadata, filename: relativePath });
  chunks.push(...parsed.sections);
  helpTopics.push({
    ...parsed.metadata,
    filename: relativePath,
    sections: parsed.sections.map(({ id, heading, content }) => ({ id, heading, content })),
  });
}

const capabilityIds = new Set(capabilities.map(capability => capability.id));
for (const document of documents) {
  if (!capabilityIds.has(document.capability)) {
    throw new Error(`${document.filename}: unknown capability ${document.capability}`);
  }
}

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify({ version: 1, documents, capabilities, chunks }, null, 2)}\n`);
await fs.writeFile(helpOutputPath, `${JSON.stringify({ version: 1, topics: helpTopics }, null, 2)}\n`);
console.log(`Built private Solvantis indexes with ${documents.length} documents, ${chunks.length} assistant chunks, and ${helpTopics.length} help topics.`);