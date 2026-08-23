import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const docsDirectory = path.join(root, 'docs', 'assistant');
const helpDirectory = path.join(root, 'docs', 'help');
const capabilityPath = path.join(root, 'src', 'lib', 'assistant', 'capabilities.json');
const outputDirectory = path.join(root, 'src', 'generated');
const outputPath = path.join(outputDirectory, 'solvantis-assistant-index.json');
const helpOutputPath = path.join(outputDirectory, 'solvantis-help-index.json');
const validAudiences = new Set(['ims', 'pos', 'wholesale']);
const overviewPath = path.join(root, 'project_overview.md');
const overviewSectionHeading = 'Assistant-Safe Product Reference';
const unsafeOverviewPatterns = [
  /\b(?:password|secret|credential|access token|refresh token|authorization header|cookie)\b/i,
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

function plainHeading(value) {
  return value.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').trim();
}

function inferOverviewMetadata(heading, content, capabilities) {
  const headingValue = heading.toLowerCase();
  const value = `${heading} ${content}`.toLowerCase();
  const capability = headingValue.includes('wholesale') ? 'wholesale'
    : /\bpos\b|point of sale/.test(headingValue) ? 'pos'
    : /inventory|stock|product|cost|valuation|margin/.test(headingValue) ? 'inventory'
    : /purchase|sales order|backorder|fulfil|supplier receipt/.test(headingValue) ? 'orders'
    : /xero|shopify|cin7|integration|connection/.test(headingValue) ? 'integrations'
    : value.includes('wholesale') ? 'wholesale'
    : /\bpos\b|point of sale/.test(value) ? 'pos'
    : /inventory|stock|product|cost|valuation|margin/.test(value) ? 'inventory'
    : /purchase|sales order|backorder|fulfil|supplier receipt/.test(value) ? 'orders'
    : /xero|shopify|cin7|integration|connection/.test(value) ? 'integrations'
    : 'navigation';
  const definition = capabilities.find(item => item.id === capability) ?? capabilities[0];
  return {
    audiences: definition.audiences,
    capability: definition.id,
    screen: definition.screens[0] ?? 'Solvantis',
  };
}

function parseOverview(source, capabilities) {
  const lines = source.split(/\r?\n/);
  const sectionStart = lines.findIndex(line => /^##\s+/.test(line) && plainHeading(line.replace(/^##\s+/, '')) === overviewSectionHeading);
  if (sectionStart < 0) throw new Error(`project_overview.md: missing ${overviewSectionHeading} section`);
  const sectionLines = [];
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    sectionLines.push(lines[index]);
  }
  const sectionText = sectionLines.join('\n');
  const unsafe = unsafeOverviewPatterns.find(pattern => pattern.test(sectionText));
  if (unsafe) throw new Error(`project_overview.md: assistant-safe section contains forbidden internal or sensitive content (${unsafe})`);

  const sections = [];
  let heading = overviewSectionHeading;
  let body = [];
  const flush = () => {
    const content = body.join('\n').trim();
    if (!content || heading === overviewSectionHeading) return;
    const metadata = inferOverviewMetadata(heading, content, capabilities);
    sections.push({
      id: `project-overview:${sections.length + 1}`,
      documentId: 'project-overview',
      title: 'Solvantis product reference',
      heading,
      ...metadata,
      sourcePriority: 3,
      lastReviewed: new Date().toISOString().slice(0, 10),
      content,
    });
  };
  for (const line of sectionLines) {
    if (/^###\s+/.test(line)) {
      flush();
      heading = plainHeading(line.replace(/^###\s+/, ''));
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  if (sections.length === 0) throw new Error('project_overview.md: assistant-safe section has no product subsections');
  return sections;
}

const filenames = (await fs.readdir(docsDirectory)).filter(filename => filename.endsWith('.md')).sort();
const documents = [];
const chunks = [];
const helpTopics = [];
const ids = new Set();
const capabilities = JSON.parse(await fs.readFile(capabilityPath, 'utf8'));
for (const filename of filenames) {
  const parsed = parseDocument(filename, await fs.readFile(path.join(docsDirectory, filename), 'utf8'));
  if (ids.has(parsed.metadata.id)) throw new Error(`Duplicate assistant document id: ${parsed.metadata.id}`);
  ids.add(parsed.metadata.id);
  documents.push({ ...parsed.metadata, filename });
  chunks.push(...parsed.sections);
}

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

const overviewChunks = parseOverview(await fs.readFile(overviewPath, 'utf8'), capabilities);
documents.push({
  id: 'project-overview',
  title: 'Solvantis product reference',
  audiences: Array.from(validAudiences),
  capability: 'navigation',
  screen: 'Solvantis',
  lastReviewed: new Date().toISOString().slice(0, 10),
  owner: 'product',
  filename: 'project_overview.md',
});
chunks.push(...overviewChunks);

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