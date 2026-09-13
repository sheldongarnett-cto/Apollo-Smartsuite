/**
 * Apollo Device-Match Proxy — serverless version
 * -----------------------------------------------------------------------
 * Same logic as index.js, packaged as a single handler function so it can
 * be deployed with no server to manage — e.g. as a Vercel/Netlify function,
 * an AWS Lambda behind API Gateway, or a Cloudflare Worker (minor request/
 * response shape edits needed for Cloudflare's fetch-based Workers runtime).
 *
 * Deploy target shown here: Vercel/Netlify-style Node function
 * (module.exports.handler(req, res) with req.query already parsed).
 *
 * Environment variables (set in the platform's dashboard, never in code):
 *   APOLLO_BASE_URL       default https://apollo.spacera.io/api/partner/v1
 *   APOLLO_API_KEY        Apollo partner key — server-side only
 *   PROXY_SHARED_SECRET   bearer token SmartSuite's webhook header must send
 */

const APOLLO_BASE_URL = process.env.APOLLO_BASE_URL || 'https://apollo.spacera.io/api/partner/v1';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
const PROXY_SHARED_SECRET = process.env.PROXY_SHARED_SECRET;

async function fetchApolloDevices(customerId, workspaceId) {
  const url = new URL(`${APOLLO_BASE_URL}/customers/${encodeURIComponent(customerId)}/devices`);
  url.searchParams.set('workspaceId', workspaceId);
  url.searchParams.set('limit', '500');

  const resp = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${APOLLO_API_KEY}`, 'Content-Type': 'application/json' },
  });

  const body = await resp.json().catch(() => null);
  if (!resp.ok || !body) {
    const err = new Error('apollo_upstream_error');
    err.status = resp.status || 502;
    err.body = body;
    throw err;
  }
  return body;
}

module.exports.handler = async function handler(req, res) {
  const auth = req.headers['authorization'] || '';
  if (!PROXY_SHARED_SECRET || auth !== `Bearer ${PROXY_SHARED_SECRET}`) {
    return res.status(401).json({ error: { code: 'unauthorized', message: 'missing or invalid proxy bearer token' } });
  }

  const { customerId, workspaceId, serialNumber } = req.query || {};
  if (!customerId || !workspaceId || !serialNumber) {
    return res.status(400).json({
      error: { code: 'invalid_request', message: 'customerId, workspaceId and serialNumber are all required' },
    });
  }

  try {
    const apolloJson = await fetchApolloDevices(customerId, workspaceId);
    const devices = apolloJson.data || [];
    const needle = String(serialNumber).trim().toLowerCase();
    const match = devices.find((d) => String(d.serialNumber || '').trim().toLowerCase() === needle);

    if (!match) {
      return res.status(200).json({ data: { matched: false } });
    }

    return res.status(200).json({
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
    return res.status(err.status || 502).json({
      error: { code: 'upstream_error', message: String((err.body && err.body.error) || err.message) },
    });
  }
};

/**
 * SmartSuite webhook action, once deployed:
 *   Method: GET
 *   URL: https://<your-deployment>.vercel.app/api/device-match
 *          ?customerId={{Apollo Customer ID}}
 *          &workspaceId={{Apollo Workspace ID}}
 *          &serialNumber={{Serial Number}}
 *   Headers: Authorization: Bearer <PROXY_SHARED_SECRET>
 *   Response Content mappings (all flat scalars again, same pattern as the
 *   working room-level fields):
 *     data.matched      -> (branch condition: true / false)
 *     data.deviceId     -> Apollo Device ID
 *     data.lastSeenAt   -> Last Seen At
 *     data.status       -> (any additional device fields you add)
 */