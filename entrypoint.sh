#!/bin/sh
set -e
cp /tmp/default.conf /etc/nginx/conf.d/default.conf
exec nginx -g "daemon off;"
