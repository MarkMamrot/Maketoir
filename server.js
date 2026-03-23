// server.js for cPanel (Phusion Passenger)
const http = require('http');
const { parse } = require('url');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Auto-build system for cPanel where NPM run build fails
const buildIdPath = path.join(__dirname, '.next', 'BUILD_ID');
if (!fs.existsSync(buildIdPath)) {
  console.log('Next.js build not found. Server is automatically building it now...');
  try {
    // Check if node_modules exists, if not run npm install
    if (!fs.existsSync(path.join(__dirname, 'node_modules', 'next'))) {
      console.log('node_modules not found. Running npm install...');
      execSync('npm install --omit=dev --foreground-scripts=false --fund=false --audit=false --no-progress', { stdio: 'inherit', cwd: __dirname });
    }

    // Explicitly use the local Next.js binary to bypass cPanel path errors
    console.log('Running next build...');
    execSync('npx next build', {
      stdio: 'inherit',
      cwd: __dirname,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
    });
    console.log('Build completed successfully.');
  } catch (err) {
    console.error('Auto-build failed:', err);
  }
}

// We have strictly isolated dependencies in Passenger sometimes.
// By calling the full absolute path or ensuring execution happens locally, it can find node.
let next;
try {
  next = require('next');
} catch (e) {
  // Try resolving from the project's local node_modules specifically
  next = require('./node_modules/next');
}

const port = process.env.PORT || 3000;
const app = next({ dev: false });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  
  if (process.env.PASSENGER_APP_ENV) {
    // Let Passenger manage the sockets automatically
    server.listen(port, () => console.log('Listening via Passenger..'));
  } else {
    // Local fallback
    server.listen(port, () => console.log(`Listening on ${port}`));
  }
}).catch((err) => {
  console.error("Next.js App failed to start", err);
});


