#!/bin/bash
set -e

# WireGuard Setup Script for KeyRoute
# Run this once on each server to configure WireGuard

WG_INTERFACE="wg0"
WG_PORT=51820
WG_SUBNET="10.100.0"

echo "Setting up WireGuard for KeyRoute..."

# Install WireGuard
apt-get update
apt-get install -y wireguard wireguard-tools

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" >> /etc/sysctl.conf
sysctl -p

# Generate server keys if not exist
if [ ! -f /etc/wireguard/server_private.key ]; then
  wg genkey > /etc/wireguard/server_private.key
  chmod 600 /etc/wireguard/server_private.key
  cat /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key
fi

SERVER_PRIVATE_KEY=$(cat /etc/wireguard/server_private.key)
SERVER_PUBLIC_KEY=$(cat /etc/wireguard/server_public.key)

# Get public IP
PUBLIC_IP=$(curl -s ifconfig.me)

echo "Server public key: ${SERVER_PUBLIC_KEY}"
echo "Server public IP: ${PUBLIC_IP}"

# Create WireGuard config
cat > /etc/wireguard/${WG_INTERFACE}.conf << EOF
[Interface]
PrivateKey = ${SERVER_PRIVATE_KEY}
Address = ${WG_SUBNET}.1/24
ListenPort = ${WG_PORT}
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# Peers are added dynamically by the API
EOF

chmod 600 /etc/wireguard/${WG_INTERFACE}.conf

# Enable and start WireGuard
systemctl enable wg-quick@${WG_INTERFACE}
systemctl start wg-quick@${WG_INTERFACE}

# Show status
wg show

echo ""
echo "WireGuard setup complete!"
echo ""
echo "Add these to your KeyRoute .env file:"
echo "WG_SERVER_PRIVATE_KEY=${SERVER_PRIVATE_KEY}"
echo "WG_SERVER_PUBLIC_KEY=${SERVER_PUBLIC_KEY}"
echo "SERVER_PUBLIC_IP=${PUBLIC_IP}"
echo "WG_PORT=${WG_PORT}"
