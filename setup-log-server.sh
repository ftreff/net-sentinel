#!/bin/bash

# Net Sentinel - Router Log Server Setup
# This script configures rsyslog to receive logs from a router and save them to /var/log/router.log

set -e

echo "🔧 Installing rsyslog if not present..."
sudo apt update
sudo apt install -y rsyslog

echo ""
read -p "📡 Enter your router's IP address: " ROUTER_IP

if [[ ! $ROUTER_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ Invalid IP address format."
  exit 1
fi

echo "📦 Enabling UDP reception in rsyslog..."
sudo sed -i '/^#module(load="imudp")/s/^#//' /etc/rsyslog.conf
sudo sed -i '/^#input(type="imudp" port="514")/s/^#//' /etc/rsyslog.conf

echo "📝 Creating custom rule for router logs..."
sudo tee /etc/rsyslog.d/20-router.conf > /dev/null <<EOF
# Save all incoming UDP logs from router to /var/log/router.log
:fromhost-ip, isequal, "$ROUTER_IP" /var/log/router.log
& stop
EOF

echo "📁 Creating log file and setting permissions..."
sudo touch /var/log/router.log

# Detect rsyslog user; default to root if not present
if id -u syslog >/dev/null 2>&1; then
    echo "ℹ️ Using syslog user for ownership"
    sudo chown syslog:adm /var/log/router.log
else
    echo "ℹ️ No syslog user found, using root"
    sudo chown root:adm /var/log/router.log
fi

sudo chmod 640 /var/log/router.log

echo "🔄 Restarting rsyslog..."
sudo systemctl restart rsyslog

echo "🛡️ Enabling rsyslog to start on boot..."
sudo systemctl enable rsyslog

echo "🔍 Verifying rsyslog status..."
sudo systemctl is-enabled rsyslog && echo "✅ rsyslog is enabled on boot." || echo "❌ rsyslog failed to enable."

echo ""
echo "📦 Log server is ready and will start automatically on reboot."
echo "➡️ Configure your router to send syslog to this server's IP on UDP port 514."
echo "📄 Logs will appear in: /var/log/router.log"
echo "🧪 Run tail -f /var/log/router.log to confirm logs are arriving."
