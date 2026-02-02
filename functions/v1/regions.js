// Cloudflare Pages Function - GET /v1/regions
// Returns available regions and their status

const REGIONS = [
  {
    id: 'eu-frankfurt',
    name: 'Frankfurt',
    country: 'Germany',
    country_code: 'DE',
    status: 'online'
  },
  {
    id: 'ap-sydney',
    name: 'Sydney',
    country: 'Australia',
    country_code: 'AU',
    status: 'online'
  },
  {
    id: 'us-west',
    name: 'San Francisco',
    country: 'USA',
    country_code: 'US',
    status: 'online'
  },
  {
    id: 'us-east',
    name: 'New York',
    country: 'USA',
    country_code: 'US',
    status: 'online'
  }
];

export async function onRequestGet(context) {
  return new Response(JSON.stringify({ regions: REGIONS }, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60'
    }
  });
}

export async function onRequestOptions(context) {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
