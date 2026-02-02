// Cloudflare Pages Function - Serve OpenAPI spec
export async function onRequest(context) {
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'KeyRoute API',
      description: 'WireGuard VPN tunnels for AI agents. Create encrypted tunnels from multiple global regions for geo-routing and privacy.',
      version: '1.0.0',
      contact: { name: 'KeyRoute Support', url: 'https://keyroute.world', email: 'support@keyroute.world' },
      'x-logo': { url: 'https://keyroute.world/logo.png' }
    },
    servers: [{ url: 'https://keyroute.world', description: 'Production' }],
    tags: [
      { name: 'Tunnels', description: 'Manage VPN tunnels' },
      { name: 'Regions', description: 'Available tunnel regions' }
    ],
    paths: {
      '/v1/tunnel': {
        post: {
          tags: ['Tunnels'],
          summary: 'Create a VPN tunnel',
          description: 'Create a new WireGuard VPN tunnel. Returns configuration to connect.',
          operationId: 'createTunnel',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TunnelRequest' },
                example: { duration: 300, region: 'us-east' }
              }
            }
          },
          responses: {
            '201': { description: 'Tunnel created', content: { 'application/json': { schema: { $ref: '#/components/schemas/TunnelResponse' } } } },
            '401': { $ref: '#/components/responses/Unauthorized' },
            '402': { description: 'Insufficient credits' }
          }
        }
      },
      '/v1/tunnel/{id}': {
        get: {
          tags: ['Tunnels'],
          summary: 'Get tunnel status',
          operationId: 'getTunnel',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Tunnel status', content: { 'application/json': { schema: { $ref: '#/components/schemas/TunnelStatus' } } } },
            '404': { description: 'Tunnel not found' }
          }
        },
        delete: {
          tags: ['Tunnels'],
          summary: 'Close tunnel early',
          operationId: 'closeTunnel',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Tunnel closed', content: { 'application/json': { schema: { $ref: '#/components/schemas/TunnelClosed' } } } },
            '404': { description: 'Tunnel not found' }
          }
        }
      },
      '/v1/tunnels': {
        get: {
          tags: ['Tunnels'],
          summary: 'List your tunnels',
          operationId: 'listTunnels',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': { description: 'List of tunnels', content: { 'application/json': { schema: { $ref: '#/components/schemas/TunnelList' } } } }
          }
        }
      },
      '/v1/regions': {
        get: {
          tags: ['Regions'],
          summary: 'List available regions',
          description: 'Get list of available tunnel regions (Frankfurt, Sydney, San Francisco, New York).',
          operationId: 'listRegions',
          responses: {
            '200': { description: 'List of regions', content: { 'application/json': { schema: { $ref: '#/components/schemas/RegionsResponse' } } } }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'KeyKeeper API token from keykeeper.world' }
      },
      schemas: {
        TunnelRequest: {
          type: 'object',
          properties: {
            duration: { type: 'integer', minimum: 30, maximum: 3600, default: 300, description: 'Tunnel duration in seconds' },
            region: { type: 'string', enum: ['eu-frankfurt', 'ap-sydney', 'us-west', 'us-east'], description: 'Tunnel region' }
          }
        },
        TunnelResponse: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string' },
            region: { type: 'string' },
            wireguard_config: { type: 'string', description: 'WireGuard configuration file contents' },
            endpoint: { type: 'string' },
            expires_at: { type: 'string', format: 'date-time' },
            client_ip: { type: 'string' }
          }
        },
        TunnelStatus: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string' },
            region: { type: 'string' },
            status: { type: 'string', enum: ['active', 'expired', 'closed'] },
            created_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
            duration_seconds: { type: 'integer' },
            cost_usd: { type: 'number' }
          }
        },
        TunnelClosed: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string' },
            status: { type: 'string' },
            duration_seconds: { type: 'integer' },
            cost_usd: { type: 'number' }
          }
        },
        TunnelList: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            balance: { type: 'number' },
            tunnels: { type: 'array', items: { $ref: '#/components/schemas/TunnelSummary' } }
          }
        },
        TunnelSummary: {
          type: 'object',
          properties: {
            tunnel_id: { type: 'string' },
            region: { type: 'string' },
            status: { type: 'string' },
            created_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' }
          }
        },
        RegionsResponse: {
          type: 'object',
          properties: {
            regions: { type: 'array', items: { $ref: '#/components/schemas/Region' } },
            current: { type: 'string' }
          }
        },
        Region: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            country: { type: 'string' },
            status: { type: 'string', enum: ['online', 'offline'] }
          }
        },
        Error: { type: 'object', properties: { error: { type: 'string' } } }
      },
      responses: {
        Unauthorized: { description: 'Missing or invalid authentication', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
      }
    }
  };

  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
