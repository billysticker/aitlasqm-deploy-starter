FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN useradd --system --uid 10001 gateway
COPY --from=builder --chown=gateway:gateway /app/.next/standalone ./
COPY --from=builder --chown=gateway:gateway /app/.next/static ./.next/static
USER gateway
EXPOSE 8080
CMD ["node", "server.js"]
