import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

// Configuration
const REGION = process.env.KEYROUTE_REGION || 'unknown';
const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVER_PUBLIC_IP = process.env.SERVER_PUBLIC_IP || '127.0.0.1';
const WG_INTERFACE = process.env.WG_INTERFACE || 'wg0';
const WG_PORT = parseInt(process.env.WG_PORT || '51820', 10);
const WG_SUBNET = process.env.WG_SUBNET || '10.100.0';
const KEYKEEPER_API = process.env.KEYKEEPER_API || 'https://keykeeper.world/api';
const SERVICE_SECRET = process.env.SERVICE_SECRET || 'dev-service-secret';
const USAGE_REPORT_INTERVAL = parseInt(process.env.USAGE_REPORT_INTERVAL || '30000', 10); // 30 seconds

// Server private/public keys (generated on first run or from env)
let serverPrivateKey = process.env.WG_SERVER_PRIVATE_KEY || '';
let serverPublicKey = process.env.WG_SERVER_PUBLIC_KEY || '';

interface Tunnel {
  id: string;
  agent_id: string;
  region: string;
  created_at: Date;
  expires_at: Date;
  client_private_key: string;
  client_public_key: string;
  client_ip: string;
  status: 'active' | 'expired' | 'closed';
  last_billed_at: Date; // Track when we last billed
}

interface TunnelRequest {
  region?: string;
  duration: number; // seconds, 30-3600
}

interface TunnelResponse {
  tunnel_id: string;
  region: string;
  wireguard_config: string;
  endpoint: string;
  expires_at: string;
  client_ip: string;
}

interface VerifyResponse {
  valid: boolean;
  agent_id?: string;
  email?: string;
  balance?: number;
  cost_per_unit?: number;
  can_afford?: boolean;
  error?: string;
}

interface UsageRecord {
  agent_id: string;
  operation: string;
  quantity: number;
  timestamp: string;
  metadata: {
    region: string;
    tunnel_id: string;
    duration_seconds?: number;
    data_bytes?: number;
  };
}

// Active tunnels storage
const tunnels = new Map<string, Tunnel>();
let nextClientIP = 2; // Start from .2, .1 is server

// Pending usage records to be reported to KeyKeeper
const pendingUsage: UsageRecord[] = [];

// Cache for token verification (TTL 60 seconds)
const tokenCache = new Map<string, { result: VerifyResponse; expires: number }>();
const TOKEN_CACHE_TTL = 60000; // 1 minute

// Generate WireGuard keypair
function generateKeyPair(): { privateKey: string; publicKey: string } {
  try {
    const privateKey = execSync('wg genkey', { encoding: 'utf-8' }).trim();
    const publicKey = execSync(`echo "${privateKey}" | wg pubkey`, { encoding: 'utf-8' }).trim();
    return { privateKey, publicKey };
  } catch {
    // Fallback: generate random keys (won't actually work for WireGuard but useful for testing)
    const privateKey = crypto.randomBytes(32).toString('base64');
    const publicKey = crypto.randomBytes(32).toString('base64');
    console.warn('WireGuard not available, using mock keys');
    return { privateKey, publicKey };
  }
}

// Initialize server keys if not set
function initServerKeys() {
  if (!serverPrivateKey || !serverPublicKey) {
    console.log('Generating server WireGuard keys...');
    const keys = generateKeyPair();
    serverPrivateKey = keys.privateKey;
    serverPublicKey = keys.publicKey;
    console.log('Server public key:', serverPublicKey);
  }
}

// Add peer to WireGuard
async function addPeer(publicKey: string, clientIP: string): Promise<boolean> {
  try {
    await execAsync(`wg set ${WG_INTERFACE} peer ${publicKey} allowed-ips ${clientIP}/32`);
    return true;
  } catch (error) {
    console.error('Failed to add WireGuard peer:', error);
    return false;
  }
}

// Remove peer from WireGuard
async function removePeer(publicKey: string): Promise<boolean> {
  try {
    await execAsync(`wg set ${WG_INTERFACE} peer ${publicKey} remove`);
    return true;
  } catch (error) {
    console.error('Failed to remove WireGuard peer:', error);
    return false;
  }
}

// Generate client WireGuard config
function generateClientConfig(tunnel: Tunnel): string {
  return `[Interface]
PrivateKey = ${tunnel.client_private_key}
Address = ${tunnel.client_ip}/24
DNS = 1.1.1.1

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${SERVER_PUBLIC_IP}:${WG_PORT}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;
}

// Verify token against KeyKeeper API
async function verifyToken(token: string, operation: string = 'tunnel_hour', quantity: number = 1): Promise<VerifyResponse> {
  if (!token) {
    return { valid: false, error: 'No token provided' };
  }

  // Check cache first
  const cached = tokenCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return cached.result;
  }

  try {
    const response = await fetch(`${KEYKEEPER_API}/v1/services/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': SERVICE_SECRET,
      },
      body: JSON.stringify({
        token,
        service: 'keyroute',
        operation,
        quantity,
      }),
    });

    const data = await response.json() as VerifyResponse;

    // Cache successful verifications
    if (data.valid) {
      tokenCache.set(token, {
        result: data,
        expires: Date.now() + TOKEN_CACHE_TTL,
      });
    }

    return data;
  } catch (error) {
    console.error('KeyKeeper verification error:', error);
    return { valid: false, error: 'Authentication service unavailable' };
  }
}

// Report usage to KeyKeeper
async function reportUsage(): Promise<void> {
  if (pendingUsage.length === 0) {
    return;
  }

  // Take all pending records
  const records = pendingUsage.splice(0, pendingUsage.length);

  try {
    const response = await fetch(`${KEYKEEPER_API}/v1/services/usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Secret': SERVICE_SECRET,
      },
      body: JSON.stringify({
        service: 'keyroute',
        region: REGION,
        records: records,
      }),
    });

    if (!response.ok) {
      console.error('Usage report failed:', await response.text());
      // Put records back for retry
      pendingUsage.push(...records);
    } else {
      const result = await response.json();
      console.log(`Usage reported: ${result.processed} records, ${result.total_credits_deducted} credits deducted`);
    }
  } catch (error) {
    console.error('Failed to report usage to KeyKeeper:', error);
    // Put records back for retry
    pendingUsage.push(...records);
  }
}

// Bill active tunnels periodically
function billActiveTunnels() {
  const now = new Date();
  for (const [_id, tunnel] of tunnels) {
    if (tunnel.status === 'active') {
      // Calculate hours since last billed
      const secondsSinceLastBill = Math.floor((now.getTime() - tunnel.last_billed_at.getTime()) / 1000);

      // Bill every minute (0.1/60 = ~$0.00167 per minute)
      if (secondsSinceLastBill >= 60) {
        const minutesToBill = Math.floor(secondsSinceLastBill / 60);
        const hoursToReport = minutesToBill / 60; // Convert to hours for reporting

        pendingUsage.push({
          agent_id: tunnel.agent_id,
          operation: 'tunnel_hour',
          quantity: hoursToReport,
          timestamp: now.toISOString(),
          metadata: {
            region: REGION,
            tunnel_id: tunnel.id,
            duration_seconds: minutesToBill * 60,
          },
        });

        tunnel.last_billed_at = new Date(tunnel.last_billed_at.getTime() + minutesToBill * 60 * 1000);
      }
    }
  }
}

// Cleanup expired tunnels and bill them
async function cleanupExpiredTunnels() {
  const now = new Date();
  for (const [id, tunnel] of tunnels) {
    if (tunnel.status === 'active' && tunnel.expires_at < now) {
      console.log(`Expiring tunnel ${id}`);

      // Bill remaining time
      const remainingSeconds = Math.floor((tunnel.expires_at.getTime() - tunnel.last_billed_at.getTime()) / 1000);
      if (remainingSeconds > 0) {
        pendingUsage.push({
          agent_id: tunnel.agent_id,
          operation: 'tunnel_hour',
          quantity: remainingSeconds / 3600,
          timestamp: now.toISOString(),
          metadata: {
            region: REGION,
            tunnel_id: tunnel.id,
            duration_seconds: remainingSeconds,
          },
        });
      }

      tunnel.status = 'expired';
      await removePeer(tunnel.client_public_key);
    }
  }
}

// Initialize
initServerKeys();

// Cleanup interval
setInterval(cleanupExpiredTunnels, 10000); // Every 10 seconds

// Bill active tunnels every minute
setInterval(billActiveTunnels, 60000); // Every minute

// Report usage to KeyKeeper periodically
setInterval(reportUsage, USAGE_REPORT_INTERVAL);

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}));

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    region: REGION,
    timestamp: new Date().toISOString(),
    active_tunnels: Array.from(tunnels.values()).filter(t => t.status === 'active').length,
    pending_usage_records: pendingUsage.length
  });
});

// List regions
app.get('/v1/regions', (c) => {
  return c.json({
    regions: [
      { id: 'eu-frankfurt', name: 'Frankfurt', country: 'DE', status: 'online' },
      { id: 'ap-sydney', name: 'Sydney', country: 'AU', status: 'online' },
      { id: 'us-west', name: 'San Francisco', country: 'US', status: 'online' },
      { id: 'us-east', name: 'New York', country: 'US', status: 'online' },
    ],
    current: REGION,
  });
});

// Create tunnel
app.post('/v1/tunnel', async (c) => {
  // Auth
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);

  // Parse request first to get duration for cost calculation
  let body: TunnelRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Validate duration (30 seconds to 1 hour)
  const duration = Math.max(30, Math.min(body.duration || 300, 3600));
  const estimatedHours = duration / 3600;

  // Verify token and check if they can afford the tunnel
  const auth = await verifyToken(token, 'tunnel_hour', estimatedHours);
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  // Check if agent can afford the tunnel
  if (auth.can_afford === false) {
    return c.json({
      error: 'Insufficient credits',
      balance: auth.balance,
      estimated_cost: estimatedHours * (auth.cost_per_unit || 0.10),
      cost_per_hour: auth.cost_per_unit,
    }, 402);
  }

  // Generate tunnel
  const tunnelId = `tun_${crypto.randomBytes(8).toString('hex')}`;
  const { privateKey, publicKey } = generateKeyPair();
  const clientIP = `${WG_SUBNET}.${nextClientIP++}`;

  // Wrap IP counter
  if (nextClientIP > 254) nextClientIP = 2;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + duration * 1000);

  const tunnel: Tunnel = {
    id: tunnelId,
    agent_id: auth.agent_id!,
    region: REGION,
    created_at: now,
    expires_at: expiresAt,
    client_private_key: privateKey,
    client_public_key: publicKey,
    client_ip: clientIP,
    status: 'active',
    last_billed_at: now,
  };

  // Add to WireGuard
  const added = await addPeer(publicKey, clientIP);
  if (!added) {
    console.warn('Failed to add peer to WireGuard (may not be installed)');
  }

  tunnels.set(tunnelId, tunnel);

  const response: TunnelResponse = {
    tunnel_id: tunnelId,
    region: REGION,
    wireguard_config: generateClientConfig(tunnel),
    endpoint: `${SERVER_PUBLIC_IP}:${WG_PORT}`,
    expires_at: expiresAt.toISOString(),
    client_ip: clientIP,
  };

  console.log(`Created tunnel ${tunnelId} for ${auth.agent_id}, expires in ${duration}s`);

  return c.json(response, 201);
});

// Get tunnel status
app.get('/v1/tunnel/:id', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const auth = await verifyToken(authHeader.slice(7));
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  const tunnelId = c.req.param('id');
  const tunnel = tunnels.get(tunnelId);

  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404);
  }

  if (tunnel.agent_id !== auth.agent_id) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  // Check if expired
  if (tunnel.status === 'active' && tunnel.expires_at < new Date()) {
    tunnel.status = 'expired';
    await removePeer(tunnel.client_public_key);
  }

  const durationSeconds = Math.floor((
    (tunnel.status === 'active' ? new Date() : tunnel.expires_at).getTime() -
    tunnel.created_at.getTime()
  ) / 1000);

  const costPerHour = 0.10; // $0.10 per hour

  return c.json({
    tunnel_id: tunnel.id,
    region: tunnel.region,
    status: tunnel.status,
    created_at: tunnel.created_at.toISOString(),
    expires_at: tunnel.expires_at.toISOString(),
    duration_seconds: durationSeconds,
    cost_usd: (durationSeconds / 3600) * costPerHour,
  });
});

// Close tunnel early
app.delete('/v1/tunnel/:id', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const auth = await verifyToken(authHeader.slice(7));
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  const tunnelId = c.req.param('id');
  const tunnel = tunnels.get(tunnelId);

  if (!tunnel) {
    return c.json({ error: 'Tunnel not found' }, 404);
  }

  if (tunnel.agent_id !== auth.agent_id) {
    return c.json({ error: 'Unauthorized' }, 403);
  }

  if (tunnel.status !== 'active') {
    return c.json({ error: 'Tunnel already closed' }, 400);
  }

  // Calculate actual duration
  const closedAt = new Date();
  const durationSeconds = Math.floor((closedAt.getTime() - tunnel.created_at.getTime()) / 1000);

  // Bill remaining unbilled time
  const unbilledSeconds = Math.floor((closedAt.getTime() - tunnel.last_billed_at.getTime()) / 1000);
  if (unbilledSeconds > 0) {
    pendingUsage.push({
      agent_id: tunnel.agent_id,
      operation: 'tunnel_hour',
      quantity: unbilledSeconds / 3600,
      timestamp: closedAt.toISOString(),
      metadata: {
        region: REGION,
        tunnel_id: tunnel.id,
        duration_seconds: unbilledSeconds,
      },
    });
  }

  tunnel.status = 'closed';
  tunnel.expires_at = closedAt;

  // Remove from WireGuard
  await removePeer(tunnel.client_public_key);

  console.log(`Closed tunnel ${tunnelId}, duration: ${durationSeconds}s`);

  const costPerHour = 0.10;

  return c.json({
    tunnel_id: tunnel.id,
    status: 'closed',
    duration_seconds: durationSeconds,
    cost_usd: (durationSeconds / 3600) * costPerHour,
  });
});

// List active tunnels for agent
app.get('/v1/tunnels', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const auth = await verifyToken(authHeader.slice(7));
  if (!auth.valid) {
    return c.json({ error: auth.error }, 401);
  }

  const agentTunnels = Array.from(tunnels.values())
    .filter(t => t.agent_id === auth.agent_id)
    .map(t => ({
      tunnel_id: t.id,
      region: t.region,
      status: t.status,
      created_at: t.created_at.toISOString(),
      expires_at: t.expires_at.toISOString(),
    }));

  return c.json({
    agent_id: auth.agent_id,
    email: auth.email,
    balance: auth.balance,
    tunnels: agentTunnels,
  });
});

// OpenAPI spec for APIs.guru
const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'KeyRoute API',
    description: 'WireGuard VPN tunnels for AI agents. Create encrypted tunnels from multiple global regions for geo-routing and privacy.',
    version: '1.0.0',
    contact: { name: 'KeyRoute Support', url: 'https://keyroute.world', email: 'support@keyroute.world' },
    'x-logo': { url: 'https://keyroute.world/logo.png' }
  },
  servers: [{ url: 'https://api.keyroute.world', description: 'Production' }],
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
          region: { type: 'string', description: 'Preferred region (optional)' }
        }
      },
      TunnelResponse: {
        type: 'object',
        properties: {
          tunnel_id: { type: 'string' },
          region: { type: 'string' },
          wireguard_config: { type: 'string', description: 'WireGuard configuration file contents' },
          endpoint: { type: 'string', description: 'WireGuard server endpoint' },
          expires_at: { type: 'string', format: 'date-time' },
          client_ip: { type: 'string', description: 'Your IP inside the tunnel' }
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
          email: { type: 'string' },
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

app.get('/openapi.json', (c) => c.json(openapiSpec));

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Server error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Graceful shutdown - report remaining usage
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, reporting remaining usage...');
  // Bill all active tunnels for remaining time
  billActiveTunnels();
  await reportUsage();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, reporting remaining usage...');
  billActiveTunnels();
  await reportUsage();
  process.exit(0);
});

// Start server
console.log(`KeyRoute API starting on port ${PORT}`);
console.log(`Region: ${REGION}`);
console.log(`KeyKeeper API: ${KEYKEEPER_API}`);
console.log(`WireGuard interface: ${WG_INTERFACE}`);
console.log(`WireGuard port: ${WG_PORT}`);

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`Server running at http://localhost:${info.port}`);
});
