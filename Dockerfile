# syntax=docker/dockerfile:1
# Next.js 16 standalone build. Deliberately a plain Dockerfile rather than a
# platform buildpack so UAT is not a lock-in decision: the same image runs on
# Railway, Render, Fly.io, Cloud Run or any VM with docker.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* is inlined into the client bundle by `next build`, so these must
# be present HERE. Supplying them only as runtime env vars silently does nothing.
ARG NEXT_PUBLIC_ENABLE_DEMO_LOGIN
ARG NEXT_PUBLIC_DEMO_PASSWORD
ENV NEXT_PUBLIC_ENABLE_DEMO_LOGIN=$NEXT_PUBLIC_ENABLE_DEMO_LOGIN
ENV NEXT_PUBLIC_DEMO_PASSWORD=$NEXT_PUBLIC_DEMO_PASSWORD
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs
# `output: standalone` deliberately omits public/ and .next/static; the Next.js
# docs say to copy them in by hand, otherwise every static asset 404s.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Landing spot for the local-disk branch of fileService.ts. Mount a persistent
# volume here, or set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY to bypass it.
RUN mkdir -p /app/uploads/invoices && chown -R nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
