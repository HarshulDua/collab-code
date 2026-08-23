#!/usr/bin/env bash
# One-command "host a room on this LAN" launcher: detects this machine's
# real LAN IP, makes sure the dev TLS cert covers it (regenerating if a
# network change means it doesn't), makes sure Mongo/Redis are up, then
# starts the server and client bound to that IP over HTTPS.
#
# HTTPS matters here specifically because WebRTC's getUserMedia (camera/
# mic) only runs in a secure context — HTTPS, or the special-cased
# "localhost" — so a plain http://<lan-ip> origin (what a *different*
# device needs) never even prompts for permission. See
# ARCHITECTURE.md's WebRTC section for the full story.
#
# IMPORTANT — the one failure mode this script CANNOT fix: many
# college/enterprise Wi-Fi networks enable "client isolation" (AP
# isolation), which blocks device-to-device traffic on the same SSID at
# the access-point level, even though every device gets a normal-looking
# IP. No app-level networking config can work around that — see the
# CHECKLIST printed at the end of this script for how to tell the
# difference between "isolation is blocking us" and "something in the
# app is actually broken."
set -e
cd "$(dirname "$0")/.."

echo "== 1/5: Detecting this machine's LAN IP =="

# We only want adapters that look like a *real, currently connected*
# uplink: a non-empty Default Gateway (virtual adapters — VirtualBox
# host-only, Hyper-V/WSL vEthernet, Windows' Internet Connection Sharing
# 192.168.137.x — never have one), the underlying adapter actually Up
# (Windows can leave a "Deprecated" stale IP config lingering on an
# adapter that already shows Disconnected, which Get-NetIPConfiguration
# alone won't filter out but plain `ipconfig` correctly omits — this
# caught a real stale Wi-Fi lease during development), and an IPv4
# address that isn't a link-local 169.254.x.x fallback.
CANDIDATES=$(powershell -NoProfile -Command "
  Get-NetIPConfiguration | Where-Object {
    \$_.IPv4DefaultGateway -and
    \$_.NetAdapter.Status -eq 'Up' -and
    \$_.IPv4Address.IPAddress -notlike '169.254.*'
  } | ForEach-Object { \$_.IPv4Address.IPAddress }
" 2>/dev/null | tr -d '\r' | grep -v '^\s*$' || true)

CANDIDATE_COUNT=$(echo "$CANDIDATES" | grep -c . || true)

if [ "$CANDIDATE_COUNT" -eq 0 ]; then
  echo "Could not auto-detect a LAN IP (no adapter has a default gateway)."
  echo "Run 'ipconfig' yourself, find the adapter connected to your"
  echo "college network, and re-run this script as:"
  echo "  LAN_IP=<that-ip> scripts/host-lan.sh"
  exit 1
fi

# LAN_IP lets you force a single one; otherwise the server binds to all
# interfaces anyway (0.0.0.0), so with more than one active adapter
# (common on a laptop with both Wi-Fi and Ethernet/docking active) we
# just support every candidate — cert SAN and CORS cover all of them,
# and you try whichever URL your friend's device can actually reach
# (they're likely on different subnets, and only one may be routable
# between you depending on the college's network setup).
if [ -n "$LAN_IP" ]; then
  LAN_IPS="$LAN_IP"
else
  LAN_IPS="$CANDIDATES"
fi
echo "Candidate LAN IP(s):"
echo "$LAN_IPS" | sed 's/^/  - /'

echo
echo "== 2/5: Checking the dev TLS cert covers every candidate IP =="
CERT_OK=1
if [ ! -f certs/dev-cert.pem ]; then
  CERT_OK=0
else
  SAN_TEXT=$(MSYS_NO_PATHCONV=1 openssl x509 -in certs/dev-cert.pem -noout -ext subjectAltName 2>/dev/null || true)
  for ip in $LAN_IPS; do
    if ! echo "$SAN_TEXT" | grep -q "IP Address:$ip\b"; then
      CERT_OK=0
    fi
  done
fi
if [ "$CERT_OK" -eq 1 ]; then
  echo "Cert already covers all candidate IPs — no regeneration needed."
else
  echo "Cert missing or doesn't cover every candidate IP yet — regenerating..."
  scripts/generate-cert.sh
fi

echo
echo "== 3/5: Checking Mongo/Redis are up =="
if ! (echo > /dev/tcp/127.0.0.1/27017) 2>/dev/null; then
  echo "Mongo not reachable on :27017 — starting via docker-compose..."
  docker compose up -d mongo redis
  sleep 3
else
  echo "Mongo/Redis already reachable."
fi

echo
echo "== 4/5: Stopping any previous server/client on :4000 / :5173 =="
powershell -NoProfile -Command "
  Get-NetTCPConnection -LocalPort 4000,5173 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object { Stop-Process -Id \$_ -Force -ErrorAction SilentlyContinue }
" 2>/dev/null || true
sleep 1

echo
echo "== 5/5: Starting server + client (bound to all interfaces) over HTTPS =="

LOG_DIR="$(powershell -NoProfile -Command '[System.IO.Path]::GetTempPath()' | tr -d '\r')"

# The Node process itself binds to 0.0.0.0 either way (see server.js) —
# this just needs every origin that's allowed to CORS in. The client
# infers which API host to talk to from whatever URL it was actually
# loaded from at runtime (see client/src/lib/apiClient.js), so it works
# correctly no matter which of several candidate IPs someone opens —
# no per-IP client config needed.
CLIENT_ORIGIN="http://localhost:5173,https://localhost:5173"
for ip in $LAN_IPS; do
  CLIENT_ORIGIN="${CLIENT_ORIGIN},https://${ip}:5173"
done

(cd server && ENABLE_HTTPS=1 CLIENT_ORIGIN="$CLIENT_ORIGIN" \
  node src/server.js > "${LOG_DIR}collab-server.log" 2>&1 &)

(cd client && ENABLE_HTTPS=1 \
  npm run dev -- --host 0.0.0.0 > "${LOG_DIR}collab-client.log" 2>&1 &)

sleep 4

echo
echo "=========================================================="
echo " Room URL(s) to share with your friend — try whichever"
echo " matches the network they're actually on:"
echo
for ip in $LAN_IPS; do
  echo "   https://${ip}:5173"
done
echo
echo " First-time-per-device: browser will warn 'not private'"
echo " (self-signed cert) — click Advanced -> Proceed. This is"
echo " expected and safe on a LAN you control."
echo "=========================================================="
echo
FIRST_IP=$(echo "$LAN_IPS" | head -n1)
echo "If your friend's device can't load the page at all (not even"
echo "the cert warning), self-test in this order before touching the app:"
echo "  1. Can they PING $FIRST_IP (or whichever IP they're trying) from"
echo "     their device? If not, your"
echo "     college Wi-Fi almost certainly has client/AP isolation"
echo "     enabled — this blocks ALL device-to-device traffic on the"
echo "     SSID, and no app config can work around it. Options:"
echo "       - Use a personal hotspot (phone) instead of campus Wi-Fi"
echo "       - Both connect to the same Ethernet switch/router instead"
echo "       - Ask IT if the network has a 'guest isolation' toggle"
echo "  2. If ping works but the page doesn't load: Windows Firewall"
echo "     may be blocking Node — allow node.exe for Private networks"
echo "     when prompted, or check 'netsh advfirewall show allprofiles'."
echo "  3. Server/client logs if anything looks wrong:"
echo "     ${LOG_DIR}collab-server.log"
echo "     ${LOG_DIR}collab-client.log"
