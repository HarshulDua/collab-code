#!/usr/bin/env bash
# Generates a self-signed TLS cert covering localhost + every IPv4 address
# currently assigned to this machine, so it stays valid across network
# changes without needing to be regenerated every time (re-run this script
# after a network change if a *new* IP needs to be added).
#
# WebRTC's getUserMedia (camera/mic) is a browser "powerful feature" gated
# behind a secure context — HTTPS, or the special-cased "localhost". A
# plain http://<lan-ip>:... origin (needed to reach this app from a
# *different* device) is not a secure context, so the browser refuses to
# even prompt for camera/mic permission there — this is what HTTPS here
# fixes. Self-signed means every browser on every device will show a
# "not trusted" warning the first time; that's expected — click through
# it (Chrome: Advanced -> Proceed).
set -e
cd "$(dirname "$0")/.."

IPS=$(ipconfig | grep "IPv4 Address" | sed -E 's/.*: ([0-9.]+)/\1/' | grep -v '^169\.254\.')

SAN_ENTRIES="DNS:localhost,IP:127.0.0.1"
i=1
for ip in $IPS; do
  SAN_ENTRIES="$SAN_ENTRIES,IP:$ip"
  i=$((i+1))
done

echo "Generating cert for: $SAN_ENTRIES"

# MSYS_NO_PATHCONV avoids Git Bash rewriting the leading "/" in -subj into
# a Windows path (e.g. "/CN=collab-dev" -> "C:/Program Files/Git/CN=...").
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/dev-key.pem -out certs/dev-cert.pem \
  -days 397 -subj "/CN=collab-dev" \
  -addext "subjectAltName=$SAN_ENTRIES"

echo "Wrote certs/dev-cert.pem and certs/dev-key.pem"
