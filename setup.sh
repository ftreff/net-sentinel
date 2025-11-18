#!/bin/bash

echo "🔧 Setting up Net Sentinel 2..."

# Create folders
mkdir -p data/logs
mkdir -p data/geoip

# Create or reset database
if [ ! -f net_sentinel.db ]; then
  echo "🗃️ Creating database..."
  sqlite3 net_sentinel.db < schema.sql
else
  echo "🗃️ Database already exists. Skipping creation."
fi

# Install Python dependencies
echo "📦 Installing Python packages..."
sudo apt install python3-pip python3-flask python3-requests python3-geoip2 python3-dnspython -y

# Download GeoLite2 if missing
GEOIP_DB="data/geoip/GeoLite2-City.mmdb"
if [ ! -f "$GEOIP_DB" ]; then
  echo "🌍 Downloading GeoLite2-City.mmdb..."
  echo "⚠️ You must have a MaxMind license key to download this file."
  echo "Visit https://dev.maxmind.com/geoip/geolite2-free-geolocation-data?lang=en to get access."
else
  echo "🌍 GeoIP database already exists."
fi

echo "✅ Setup complete."
