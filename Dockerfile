FROM node@sha256:7eb2c0c4b8cf6fd761f0e6a7fed8d3b8ad59186848f0eee59744e546f1b6a3e9 AS web-build
WORKDIR /build
COPY package.json package-lock.json build.mjs tsconfig.json ./
RUN npm ci --ignore-scripts
COPY index.html ./
COPY assets ./assets
COPY src ./src
RUN npm run typecheck && npm run build

FROM nginx:1.27.3-alpine
RUN rm -rf /usr/share/nginx/html/*
COPY --from=web-build /build/dist /usr/share/nginx/html
COPY <<'NGINX_CONF' /tmp/default.conf
resolver 127.0.0.11 valid=5s;

upstream voice_platform {
    server 37.60.235.136:443 max_fails=3 fail_timeout=10s;
    keepalive 32;
}

server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    client_max_body_size 1m;

    location = /api/healthz {
        proxy_pass https://voice_platform/api/healthz;
        proxy_ssl_server_name on;
        proxy_ssl_name voice-api.relate-ai.site;
        proxy_connect_timeout 10s;
        proxy_read_timeout 10s;
        proxy_next_upstream error timeout;
    }

    location = /api/diag {
        proxy_pass https://voice_platform/api/diag;
        proxy_ssl_server_name on;
        proxy_ssl_name voice-api.relate-ai.site;
        proxy_connect_timeout 10s;
        proxy_read_timeout 10s;
        proxy_next_upstream error timeout;
    }

    location /api/ {
        proxy_pass https://voice_platform;
        proxy_ssl_server_name on;
        proxy_ssl_name voice-api.relate-ai.site;
        proxy_set_header Host $proxy_host;
        proxy_connect_timeout 10s;
        proxy_read_timeout 10s;
        proxy_next_upstream error timeout;
        proxy_next_upstream_tries 2;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
        proxy_busy_buffers_size 8k;
        proxy_temp_path /tmp/nginx_proxy 1 2;
    }

    location /assets/ {
        alias /usr/share/nginx/html/assets/;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Cache-Control "no-store" always;
}
NGINX_CONF
COPY entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh
HEALTHCHECK CMD wget --no-verbose --tries=1 --timeout=3 --spider -q -O- http://127.0.0.1:8080/ || exit 1
EXPOSE 8080
ENTRYPOINT ["/docker-entrypoint-custom.sh"]
