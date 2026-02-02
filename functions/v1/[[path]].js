// Cloudflare Pages Function - Proxy /v1/* requests to regional backends
// Regional backend servers for KlawRoute
const BACKENDS = {
  'eu-frankfurt': 'http://fra.klawroute.xyz:3001',
  'ap-sydney': 'http://syd.klawroute.xyz:3001',
  'us-west': 'http://sfo.klawroute.xyz:3001',
  'us-east': 'http://nyc.klawroute.xyz:3001',
};

const BACKEND_LIST = Object.entries(BACKENDS);

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  try {
    // For POST /v1/tunnel, route to specified region
    if (request.method === 'POST' && path === '/v1/tunnel') {
      const bodyText = await request.text();
      let region = 'us-east'; // default

      try {
        const body = JSON.parse(bodyText);
        if (body.region && BACKENDS[body.region]) {
          region = body.region;
        }
      } catch (e) {
        // Not JSON or no region, use default
      }

      const backendUrl = BACKENDS[region] + path;
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: request.headers,
        body: bodyText,
      });

      return addCorsHeaders(response);
    }

    // For GET /v1/tunnels, query ALL regions and merge results
    if (request.method === 'GET' && path === '/v1/tunnels') {
      const results = await Promise.allSettled(
        BACKEND_LIST.map(async ([region, backendBase]) => {
          const response = await fetch(backendBase + path, {
            headers: request.headers,
          });
          if (!response.ok) return null;
          const data = await response.json();
          return { region, data };
        })
      );

      // Merge tunnels from all regions
      let mergedTunnels = [];
      let agentInfo = null;

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value?.data) {
          const { data } = result.value;
          if (data.tunnels) {
            mergedTunnels = mergedTunnels.concat(data.tunnels);
          }
          if (!agentInfo && data.agent_id) {
            agentInfo = {
              agent_id: data.agent_id,
              email: data.email,
              balance: data.balance,
            };
          }
        }
      }

      return new Response(JSON.stringify({
        ...agentInfo,
        tunnels: mergedTunnels,
      }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // For GET/DELETE /v1/tunnel/:id, try ALL regions until found
    if ((request.method === 'GET' || request.method === 'DELETE') && path.startsWith('/v1/tunnel/')) {
      for (const [region, backendBase] of BACKEND_LIST) {
        try {
          const response = await fetch(backendBase + path, {
            method: request.method,
            headers: request.headers,
          });

          // If found (not 404), return this response
          if (response.status !== 404) {
            return addCorsHeaders(response);
          }
        } catch (e) {
          // Backend unavailable, try next
          continue;
        }
      }

      // Not found in any region
      return new Response(JSON.stringify({ error: 'Tunnel not found' }), {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Default: route to us-east
    const backendUrl = BACKENDS['us-east'] + path + url.search;
    const response = await fetch(backendUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' ? await request.text() : undefined,
    });

    return addCorsHeaders(response);

  } catch (error) {
    return new Response(JSON.stringify({
      error: 'Backend unavailable',
      details: error.message
    }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}

async function addCorsHeaders(response) {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', '*');
  newHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  newHeaders.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
