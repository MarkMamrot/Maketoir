// server.js for cPanel (Phusion Passenger)
const http = require('http');
const { parse } = require('url');

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


