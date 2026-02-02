#!/bin/bash
set -e

# KeyRoute Deployment Script
# Deploys the API to all 4 regional servers

# Server configuration
declare -A SERVERS=(
  ["eu-frankfurt"]="134.122.87.87"
  ["ap-sydney"]="209.38.30.75"
  ["us-west"]="24.144.90.82"
  ["us-east"]="69.55.49.132"
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}KeyRoute API Deployment${NC}"
echo "========================"

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Run this script from the api/ directory${NC}"
  exit 1
fi

# Build first
echo -e "${YELLOW}Building...${NC}"
npm run build

# Create deployment package
echo -e "${YELLOW}Creating deployment package...${NC}"
rm -rf /tmp/keyroute-deploy
mkdir -p /tmp/keyroute-deploy
cp -r dist package.json package-lock.json /tmp/keyroute-deploy/
cp deploy/keyroute.service /tmp/keyroute-deploy/
cp deploy/setup-wireguard.sh /tmp/keyroute-deploy/

# Deploy to each server
deploy_to_server() {
  local region=$1
  local ip=$2

  echo -e "${YELLOW}Deploying to ${region} (${ip})...${NC}"

  # Create remote setup script
  cat > /tmp/keyroute-deploy/setup.sh << SETUP
#!/bin/bash
set -e

# Create directory
mkdir -p /opt/keyroute
cd /opt/keyroute

# Copy files
cp -r /tmp/keyroute/* .

# Install Node.js if not present
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Setup WireGuard if not already done
if [ ! -f /etc/wireguard/wg0.conf ]; then
  chmod +x setup-wireguard.sh
  ./setup-wireguard.sh
fi

# Get WireGuard keys
WG_PRIVATE=\$(cat /etc/wireguard/server_private.key)
WG_PUBLIC=\$(cat /etc/wireguard/server_public.key)
PUBLIC_IP=\$(curl -s ifconfig.me)

# Install dependencies
npm ci --production

# Create env file
cat > .env << ENV
PORT=3000
KEYROUTE_REGION=${region}
SERVER_PUBLIC_IP=\${PUBLIC_IP}
WG_INTERFACE=wg0
WG_PORT=51820
WG_SUBNET=10.100.0
WG_SERVER_PRIVATE_KEY=\${WG_PRIVATE}
WG_SERVER_PUBLIC_KEY=\${WG_PUBLIC}
KEYKEEPER_API=https://keykeeper.world/api
ENV

# Install and start service
cp keyroute.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable keyroute
systemctl restart keyroute

echo "Deployment complete for ${region}"
systemctl status keyroute --no-pager
SETUP

  # Upload and execute
  scp -o StrictHostKeyChecking=no -r /tmp/keyroute-deploy root@${ip}:/tmp/keyroute
  ssh -o StrictHostKeyChecking=no root@${ip} "chmod +x /tmp/keyroute/setup.sh && /tmp/keyroute/setup.sh && rm -rf /tmp/keyroute"

  echo -e "${GREEN}✓ ${region} deployed${NC}"
}

# Ask which servers to deploy to
echo ""
echo "Select deployment target:"
echo "  1) All servers"
echo "  2) Frankfurt (EU)"
echo "  3) Sydney (AP)"
echo "  4) San Francisco (US West)"
echo "  5) New York (US East)"
echo ""
read -p "Enter choice [1-5]: " choice

case $choice in
  1)
    for region in "${!SERVERS[@]}"; do
      deploy_to_server "$region" "${SERVERS[$region]}"
    done
    ;;
  2)
    deploy_to_server "eu-frankfurt" "${SERVERS[eu-frankfurt]}"
    ;;
  3)
    deploy_to_server "ap-sydney" "${SERVERS[ap-sydney]}"
    ;;
  4)
    deploy_to_server "us-west" "${SERVERS[us-west]}"
    ;;
  5)
    deploy_to_server "us-east" "${SERVERS[us-east]}"
    ;;
  *)
    echo -e "${RED}Invalid choice${NC}"
    exit 1
    ;;
esac

echo ""
echo -e "${GREEN}Deployment complete!${NC}"
echo ""
echo "Test endpoints:"
for region in "${!SERVERS[@]}"; do
  echo "  ${region}: http://${SERVERS[$region]}:3000/health"
done
