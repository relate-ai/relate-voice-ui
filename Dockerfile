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
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
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
