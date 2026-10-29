// Contract: docs/fx-provider.md. Synthetic daily fixture, not a market quote.
const http = require('node:http');
http
  .createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/v1/currencies/usd.json') {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint not modelled' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        date: new Date().toISOString().slice(0, 10),
        usd: { usd: 1, ngn: 1500, ghs: 12, xaf: 580, eur: 0.92 },
      }),
    );
  })
  .listen(process.env.PORT);
