#!/bin/sh
set -eu

: "${VOICE_API_URL:?VOICE_API_URL must be configured in Coolify}"

mkdir -p /usr/share/nginx/html/runtime
printf '%s\n' "$VOICE_API_URL" > /usr/share/nginx/html/runtime/voice-api-url
cp /tmp/default.conf /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
