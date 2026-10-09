# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache git

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- run ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
# Agent chat (docs/plan/22): the ACP agent runs inside this container, so its
# shell tools only see what is installed here (git, bash, ripgrep, node).
# Add a project's toolchain (php, go, …) here if the agent should use it.
ARG CLAUDE_AGENT_ACP_VERSION=0.81.1
ARG PI_CODING_AGENT_VERSION=0.87.1
ARG PI_ACP_VERSION=0.0.33
RUN apk add --no-cache bash ripgrep fd \
 && npm install -g \
      "@agentclientprotocol/claude-agent-acp@${CLAUDE_AGENT_ACP_VERSION}" \
      "@earendil-works/pi-coding-agent@${PI_CODING_AGENT_VERSION}" \
      "pi-acp@${PI_ACP_VERSION}" \
 && npm cache clean --force
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Agents offered in the chat: both installed above. (The host's own
# acp.config.json is dockerignored.)
COPY --chown=node:node acp.config.example.json ./acp.config.json
# Plugins (plugins.example.json): their servers run in this container. The
# kanban board's SQLite file lives in a volume (see docker-compose.yml).
COPY --from=builder --chown=node:node /app/plugins ./plugins
COPY --chown=node:node plugins.example.json ./plugins.json
RUN mkdir -p plugins/kanban/data && chown node:node plugins/kanban/data
# The base image's `node` user is uid 1000, which matches the host user that
# owns the repos mounted from /mnt/storage and /DATA — required for git to
# write (stage/commit) into them without permission errors.
USER node
RUN git config --global --add safe.directory '*'
EXPOSE 3000
CMD ["node", "server.js"]