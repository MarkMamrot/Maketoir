const fs = require('fs');
const http = require('http');
const path = require('path');
const { parse } = require('url');
const next = require('next');

const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';
const standaloneServerPath = path.join(__dirname, '.next', 'standalone', 'server.js');

function ensureChunkAliases() {
  const buildManifestPath = path.join(__dirname, '.next', 'build-manifest.json');
  const chunksDir = path.join(__dirname, '.next', 'static', 'chunks');

  if (!fs.existsSync(buildManifestPath) || !fs.existsSync(chunksDir)) {
    return;
  }

  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, 'utf8'));
  const expectedFiles = [
    ...(buildManifest.polyfillFiles || []),
    ...(buildManifest.rootMainFiles || []),
  ];

  for (const relativeFile of expectedFiles) {
    const aliasName = path.basename(relativeFile);
    const aliasPath = path.join(chunksDir, aliasName);
    if (fs.existsSync(aliasPath)) {
      continue;
    }

    const ext = path.extname(aliasName);
    const baseName = path.basename(aliasName, ext);
    const hashedMatch = fs.readdirSync(chunksDir).find((entry) =>
      entry !== aliasName && entry.startsWith(`${baseName}-`) && entry.endsWith(ext)
    );

    if (hashedMatch) {
      fs.copyFileSync(path.join(chunksDir, hashedMatch), aliasPath);
    }
  }
}

ensureChunkAliases();

if (!dev && fs.existsSync(standaloneServerPath)) {
  require(standaloneServerPath);
  return;
}

const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  // Don't exit — keep server alive
});

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  server.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}).catch((err) => {
  console.error('Next.js App failed to start', err);
  process.exit(1);
});