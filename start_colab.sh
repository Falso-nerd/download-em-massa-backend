#!/bin/bash
set -e

echo "🔄 Instalando dependências do sistema..."
apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs ffmpeg git

echo "📦 Instalando pacotes npm..."
npm ci || npm install

echo "🚀 Iniciando servidor Node.js..."
PORT=3000 nohup node servidor.js > server.log 2>&1 &

echo "🌍 Instalando LocalTunnel..."
npm install -g localtunnel

echo "🔗 Gerando link público..."
npx localtunnel --port 3000 --subdomain baixar-em-massa --allow-invalid-cert
