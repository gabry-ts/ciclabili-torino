# syntax=docker/dockerfile:1.7

# ---- Stage 1: build static site with Astro ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY astro.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public

# Same-origin API path because Caddy proxies /api/* to the backend.
ENV PUBLIC_API_BASE=/api/
ENV PUBLIC_ORG_ID=6771

RUN pnpm build


# ---- Stage 2: ingress (Caddy serves dist + reverse proxy /api) ----
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80
