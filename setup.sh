#!/bin/bash

echo "🔧 Setting up Net Sentinel database..."

# Create folder
mkdir -p data/geoip

# Create or reset database
echo "🗃️ Ensuring database and schema..."
if [ ! -f net_sentinel.db ]; then
  sqlite3 net_sentinel.db < schema.sql
else
  echo "🔄 Database exists — applying schema to ensure it's up to date..."
  sqlite3 net_sentinel.db < schema.sql
fi

# Install Python dependencies
echo "📦 Installing Python packages..."
sudo apt install python3-pip python3-flask python3-requests python3-geoip2 python3-dnspython -y

# Download GeoLite2 if missing
GEOIP_DB="data/geoip/GeoLite2-City.mmdb"
if [ ! -f "$GEOIP_DB" ]; then
  echo "🌍 Downloading GeoLite2-City.mmdb..."
  wget -q --show-progress https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb -O "$GEOIP_DB"
else
  echo "🌍 GeoIP database already exists."
fi

echo "✅ Setup complete."
