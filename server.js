const http = require('http');
const { parse } = require('url');
const next = require('next');

const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';
// Enforce dev: false for production environments
const app = next({ dev: false }); 
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });
  
  server.listen(port, () => {
    console.log(`Listening on port ${port}`);
  });
}).catch((err) => {
  console.error("Next.js App failed to start", err);
  process.exit(1);
});