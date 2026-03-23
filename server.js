// server.js for cPanel (Phusion Passenger)
const http = require('http');
const { parse } = require('url');
const next = require('next');

// cPanel Passenger handles the port dynamically
const port = process.env.PORT || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev: false, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, () => {
    console.log(`> App running on port ${port}`);
  });
}).catch((err) => {
  console.error("Next.js App failed to start", err);
});

