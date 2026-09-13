/**
 * Apollo Device-Match Proxy — one-file scaffold
 * -----------------------------------------------------------------------
 * MVP spec:
 *   SmartSuite's "Refresh from Apollo" automation on Room BOMs needs one
 *   flat device object matched by serialNumber, but Apollo's
 *   /customers/{customerId}/devices endpoint only returns an array with no
 *   serial-number filter. This proxy sits between SmartSuite and Apollo:
 *   it takes the same customerId/workspaceId SmartSuite already has on the
 *   record, plus the record's Serial Number, calls Apollo, filters
 *   server-side, and returns a single scalar-shaped object SmartSuite's
 *   Response Content mapper can bind to directly — no array, no indexing.
 *
 * Schema (request -> response):
 *   GET /device-match
 *     ?customerId=<Apollo customer GUID or tenant id>   (required)
 *     &workspaceId=<Apollo workspace id>                 (required)
 *     &serialNumber=<exact serial to match>               (required)
 *
 *   200 -> { "data": { "matched": true, "deviceId": "...", "serialNumber": "...",
 *                       "status": "...", "lastSeenAt": "...", "manufacturer": "...",
 *                       "model": "...", "firmwareVersion": "...", "ipAddress": "..." } }
 *   200 (no match) -> { "data": { "matched": false } }
 *   4xx/5xx -> { "error": { "code": "...", "message": "..." } }
 *
 * API route: this file *is* the route — see the `handleDeviceMatch` function.
 * Env vars:
 *   APOLLO_BASE_URL   default https://apollo.spacera.io/api/partner/v1
 *   APOLLO_API_KEY    Apollo partner key (apollo_pk_...) — kept server-side,
 *                      never exposed to SmartSuite or the browser
 *   PROXY_SHARED_SECRET  a bearer token SmartSuite sends to this proxy, so
 *                      the proxy isn't a wide-open Apollo passthrough
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const APOLLO_BASE_URL = process.env.APOLLO_BASE_URL || 'https://apollo.spacera.io/api/partner/v1';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const PROXY_SHARED_SECRET = process.env.PROXY_SHARED_SECRET;

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function fetchApolloDevices(customerId, workspaceId) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${APOLLO_BASE_URL}/customers/${encodeURIComponent(customerId)}/devices`);
    url.searchParams.set('workspaceId', workspaceId);
    url.searchParams.set('limit', '500'); // cover any room's full device list in one page

    const req = https.request(
      url,
      { method: 'GET', headers: { Authorization: `Bearer ${APOLLO_API_KEY}`, 'Content-Type': 'application/json' } },
      (apolloRes) => {
        let raw = '';
        apolloRes.on('data', (chunk) => (raw += chunk));
        apolloRes.on('end', () => {
          if (apolloRes.statusCode >= 400) {
            return reject({ status: apolloRes.statusCode, body: raw });
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject({ status: 502, body: 'Apollo returned non-JSON response' });
          }
        });
      }
    );
    req.on('error', (err) => reject({ status: 502, body: err.message }));
    req.end();
  });
}

async function handleDeviceMatch(req, res, query) {
  const auth = req.headers['authorization'] || '';
  if (!PROXY_SHARED_SECRET || auth !== `Bearer ${PROXY_SHARED_SECRET}`) {
    return jsonResponse(res, 401, { error: { code: 'unauthorized', message: 'missing or invalid proxy bearer token' } });
  }

  const { customerId, workspaceId, serialNumber } = query;
  if (!customerId || !workspaceId || !serialNumber) {
    return jsonResponse(res, 400, {
      error: { code: 'invalid_request', message: 'customerId, workspaceId and serialNumber are all required' },
    });
  }

  try {
    const apolloJson = await fetchApolloDevices(customerId, workspaceId);
    const devices = apolloJson.data || [];
    const needle = String(serialNumber).trim().toLowerCase();
    const match = devices.find((d) => String(d.serialNumber || '').trim().toLowerCase() === needle);

    if (!match) {
      return jsonResponse(res, 200, { data: { matched: false } });
    }

    return jsonResponse(res, 200, {
      data: {
        matched: true,
        deviceId: match.deviceId,
        serialNumber: match.serialNumber,
        status: match.status,
        lastSeenAt: match.lastSeenAt,
        manufacturer: match.manufacturer,
        model: match.model,
        firmwareVersion: match.firmwareVersion,
        ipAddress: match.ipAddress,
      },
    });
  } catch (err) {
    const status = err.status || 502;
    return jsonResponse(res, status, { error: { code: 'upstream_error', message: String(err.body || err.message || err) } });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'GET' && url.pathname === '/device-match') {
    const query = Object.fromEntries(url.searchParams.entries());
    return handleDeviceMatch(req, res, query);
  }
  jsonResponse(res, 404, { error: { code: 'not_found', message: 'no such route' } });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`device-match proxy listening on :${PORT}`));
}

module.exports = { server, handleDeviceMatch };