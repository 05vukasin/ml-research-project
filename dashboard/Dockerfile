# dashboard/Dockerfile — multi-stage build for Next.js 16 (standalone output)
# Stage 1: install dependencies
# Stage 2: build the app (NEXT_PUBLIC_* vars baked in at this stage)
# Stage 3: slim runtime image (only .next/standalone + static assets)

# ── Stage 1: deps ─────────────────────────────────────────────────────────────
FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: builder ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Browser-visible URLs are inlined into the JS bundle at build time.
# They must arrive as build ARGs (not runtime ENV) so they survive the bake.
ARG NEXT_PUBLIC_INFERENCE_URL
ARG NEXT_PUBLIC_TRAINER_URL
ENV NEXT_PUBLIC_INFERENCE_URL=${NEXT_PUBLIC_INFERENCE_URL}
ENV NEXT_PUBLIC_TRAINER_URL=${NEXT_PUBLIC_TRAINER_URL}

# Disable Next.js telemetry inside Docker
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Default port; overrideable at runtime via PORT env var
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

# Copy only what the standalone server needs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets and public dir are NOT included in standalone by default
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
