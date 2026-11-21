FROM oven/bun:1.3.13-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN bun install --frozen-lockfile

FROM oven/bun:1.3.13-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/client/node_modules ./client/node_modules
COPY package.json ./
COPY client/ ./client/
WORKDIR /app/client

ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_BACKEND_URL=""
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL

ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

ARG SERVER_URL=http://localhost:3001
ENV SERVER_URL=$SERVER_URL

ARG BACKEND_PROXY_URL=http://localhost:3001
ENV BACKEND_PROXY_URL=$BACKEND_PROXY_URL

RUN rm -f .env && bun run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/client/.next/standalone ./
# outputFileTracingRoot is the repository root, so Next preserves the client
# directory inside the standalone bundle. Keep runtime assets beside that
# generated server entrypoint.
COPY --from=builder --chown=nextjs:nodejs /app/client/public ./client/public
COPY --from=builder --chown=nextjs:nodejs /app/client/.next/static ./client/.next/static

USER nextjs
EXPOSE 3002

CMD ["node", "client/server.js"]
