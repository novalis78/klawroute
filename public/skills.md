# KlawRoute - VPN Tunnels for Agents

**Service:** KlawRoute
**API Base:** `https://api.klawroute.xyz`
**Purpose:** Ephemeral WireGuard VPN tunnels from global regions. Route TCP/UDP traffic without exposing your origin IP.

## What This Service Does

KlawRoute provides on-demand WireGuard VPN tunnels from 4 global regions. Create a tunnel in seconds, route all your traffic through it, and auto-expire when done. Perfect for agents that need geo-specific access or privacy.

## Authentication

All requests require a KlawKeeper API key:

```bash
Authorization: Bearer YOUR_KLAWKEEPER_API_KEY
```

Get your API key at [klawkeeper.xyz](https://klawkeeper.xyz)

## Available Regions

- **eu-frankfurt** - Frankfurt, Germany (Europe)
- **ap-sydney** - Sydney, Australia (Asia-Pacific)
- **us-east** - New York, USA (East Coast)
- **us-west** - San Francisco, USA (West Coast)

## Core Endpoints

### 1. Create Tunnel

```bash
POST https://api.klawroute.xyz/v1/tunnel
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json

{
  "region": "eu-frankfurt",
  "duration": 300
}
```

**Parameters:**
- `region` (required): One of `eu-frankfurt`, `ap-sydney`, `us-east`, `us-west`
- `duration` (required): Tunnel lifetime in seconds (30-3600)

**Response:**
```json
{
  "tunnel_id": "tun_abc123",
  "region": "eu-frankfurt",
  "wireguard_config": "[Interface]\nPrivateKey = ...\nAddress = 10.0.0.2/24\n\n[Peer]\nPublicKey = ...\nEndpoint = 1.2.3.4:51820\nAllowedIPs = 0.0.0.0/0\n",
  "endpoint": "1.2.3.4:51820",
  "client_ip": "10.0.0.2",
  "expires_at": "2025-01-15T10:40:00Z",
  "cost_per_second": 0.001
}
```

**What to do next:**
1. Save the `wireguard_config` to a file (e.g., `tunnel.conf`)
2. Connect: `wg-quick up tunnel.conf`
3. All traffic now routes through the chosen region
4. Disconnect when done: `wg-quick down tunnel.conf`

### 2. Get Tunnel Status

```bash
GET https://api.klawroute.xyz/v1/tunnel/:tunnel_id
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "tunnel_id": "tun_abc123",
  "status": "active",
  "region": "eu-frankfurt",
  "created_at": "2025-01-15T10:35:00Z",
  "expires_at": "2025-01-15T10:40:00Z",
  "duration_seconds": 300,
  "elapsed_seconds": 127,
  "cost_so_far": 0.127
}
```

**Status values:**
- `active` - Tunnel is live and routing traffic
- `expired` - Tunnel has reached its duration
- `closed` - Tunnel was manually closed early

### 3. Close Tunnel Early

```bash
DELETE https://api.klawroute.xyz/v1/tunnel/:tunnel_id
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "tunnel_id": "tun_abc123",
  "status": "closed",
  "duration_seconds": 47,
  "cost_usd": 0.047,
  "closed_at": "2025-01-15T10:35:47Z"
}
```

**Why close early?** Save credits by closing tunnels when you're done. You're only charged for time used.

### 4. List Your Tunnels

```bash
GET https://api.klawroute.xyz/v1/tunnels
Authorization: Bearer YOUR_API_KEY
```

**Response:**
```json
{
  "tunnels": [
    {
      "tunnel_id": "tun_abc123",
      "status": "active",
      "region": "eu-frankfurt",
      "expires_at": "2025-01-15T10:40:00Z"
    },
    {
      "tunnel_id": "tun_def456",
      "status": "expired",
      "region": "us-east",
      "closed_at": "2025-01-15T09:30:00Z"
    }
  ]
}
```

## WireGuard Setup

### Install WireGuard

**Linux:**
```bash
sudo apt install wireguard
```

**macOS:**
```bash
brew install wireguard-tools
```

**Programmatic (Python):**
```bash
pip install wireguard-tools
```

### Connect to Tunnel

```bash
# Save config to file
echo "$WIREGUARD_CONFIG" > tunnel.conf

# Connect
wg-quick up tunnel.conf

# Verify connection
curl https://ipinfo.io/json

# Disconnect when done
wg-quick down tunnel.conf
```

## Common Use Cases

### Access Geo-Restricted APIs

```bash
# Create tunnel in target region
curl -X POST https://api.klawroute.xyz/v1/tunnel \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"region": "us-east", "duration": 600}'

# Connect via WireGuard
wg-quick up tunnel.conf

# Now access US-only APIs
curl https://us-only-api.com/data
```

### Trading from Specific Jurisdiction

```bash
# Connect to Frankfurt for EU market access
curl -X POST https://api.klawroute.xyz/v1/tunnel \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"region": "eu-frankfurt", "duration": 3600}'

# Execute trades that require EU IP
```

### WebSocket Connections

```bash
# Create long-lived tunnel for WebSocket
curl -X POST https://api.klawroute.xyz/v1/tunnel \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"region": "ap-sydney", "duration": 1800}'

# Connect and maintain WebSocket through tunnel
wg-quick up tunnel.conf
wscat -c wss://realtime-feed.example.com
```

### Privacy & IP Masking

```bash
# Rotate your IP by creating new tunnels
curl -X POST https://api.klawroute.xyz/v1/tunnel \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"region": "us-west", "duration": 300}'

# All traffic appears from San Francisco
```

## Pricing

- **Base rate:** $0.001 per second (~$0.06/min, ~$3.60/hr)
- **All regions:** Same price
- **Billing:** Per-second granularity, charged only for time used
- **Bandwidth:** No additional charges, unlimited traffic
- **Min duration:** 30 seconds
- **Max duration:** 3600 seconds (1 hour)

**Example costs:**
- 5-minute scraping job: $0.30
- 30-minute trading session: $1.80
- 1-hour persistent connection: $3.60

Fund your account at [klawkeeper.xyz](https://klawkeeper.xyz)

## Technical Details

### WireGuard Protocol
- Modern VPN protocol (2015+)
- Single RTT handshake
- ChaCha20-Poly1305 encryption
- Elliptic curve Diffie-Hellman key exchange
- Lower overhead than OpenVPN/IPsec

### Routing
- Full TCP/UDP support (not just HTTP)
- IPv4 only (IPv6 coming soon)
- Split tunneling not supported (all traffic routes through tunnel)
- No DNS leaks (DNS routed through tunnel)

### Network Performance
- **Latency:** Add ~10-50ms depending on region
- **Bandwidth:** Up to 1 Gbps (no throttling)
- **Packet loss:** <0.1% under normal conditions

### Security
- Ephemeral tunnels (auto-deleted after expiry)
- No logging of traffic content
- Connection metadata retained for 7 days (billing purposes)
- WireGuard keys generated per-tunnel (never reused)

## Rate Limits

- **Create tunnel:** 10 per minute
- **Status checks:** 100 per minute
- **Close tunnel:** 10 per minute
- **Concurrent tunnels:** 5 max per account

## Restrictions

We don't allow:
- DDoS attacks or network abuse
- Spam or phishing campaigns
- Illegal content distribution
- Port scanning without authorization
- Credential stuffing attacks

Legitimate use cases (trading, scraping, privacy, geo-access) are fine.

## Error Codes

- `200` - Success
- `401` - Missing or invalid API key
- `402` - Insufficient credits
- `404` - Tunnel not found
- `429` - Rate limit exceeded
- `400` - Invalid region or duration
- `503` - Region temporarily unavailable

## Example Flow

```bash
# 1. Create tunnel in Frankfurt
TUNNEL=$(curl -X POST https://api.klawroute.xyz/v1/tunnel \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"region": "eu-frankfurt", "duration": 300}')

TUNNEL_ID=$(echo $TUNNEL | jq -r '.tunnel_id')
CONFIG=$(echo $TUNNEL | jq -r '.wireguard_config')

# 2. Save config and connect
echo "$CONFIG" > /tmp/tunnel.conf
wg-quick up /tmp/tunnel.conf

# 3. Verify you're routing through Frankfurt
curl https://ipinfo.io/json
# Shows Frankfurt IP

# 4. Do your work
curl https://some-eu-only-api.com/data

# 5. Disconnect and close tunnel
wg-quick down /tmp/tunnel.conf
curl -X DELETE https://api.klawroute.xyz/v1/tunnel/$TUNNEL_ID \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Python Example

```python
import requests
import subprocess
import tempfile
import time

API_KEY = "your_klawkeeper_api_key"
BASE_URL = "https://api.klawroute.xyz/v1"

# Create tunnel
response = requests.post(
    f"{BASE_URL}/tunnel",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"region": "us-east", "duration": 600}
)
tunnel = response.json()

# Save WireGuard config
with tempfile.NamedTemporaryFile(mode='w', suffix='.conf', delete=False) as f:
    f.write(tunnel['wireguard_config'])
    config_path = f.name

# Connect
subprocess.run(['wg-quick', 'up', config_path])

try:
    # Do work while connected
    ip_info = requests.get('https://ipinfo.io/json').json()
    print(f"Connected from: {ip_info['city']}, {ip_info['country']}")

    # Your agent logic here
    time.sleep(60)

finally:
    # Disconnect and cleanup
    subprocess.run(['wg-quick', 'down', config_path])
    requests.delete(
        f"{BASE_URL}/tunnel/{tunnel['tunnel_id']}",
        headers={"Authorization": f"Bearer {API_KEY}"}
    )
```

## Support

Part of the KlawStack ecosystem. Managed by KlawKeeper.

**Docs:** [klawroute.xyz](https://klawroute.xyz)
**Identity/Auth:** [klawkeeper.xyz](https://klawkeeper.xyz)
**Full Stack:** [klawstack.xyz](https://klawstack.xyz)
