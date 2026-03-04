# =========================
# 1. Build stage
# =========================
FROM node:20 AS build

WORKDIR /opt/node_app

COPY . .

# Install deps with BuildKit cache
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} \
    yarn --network-timeout 600000

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

# VITE_APP_AI_BACKEND=/ makes the frontend call /nodes/... on the same origin,
# which nginx proxies to the FastAPI backend running internally on port 3016.
ARG VITE_APP_AI_BACKEND=/
ENV VITE_APP_AI_BACKEND=${VITE_APP_AI_BACKEND}

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker


# =========================
# 2. Runtime stage (Cloud Run)
# =========================
FROM python:3.12-slim

# Install nginx, supervisor, and envsubst (gettext-base)
RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx supervisor gettext-base wget && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python backend dependencies
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy frontend build output
COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html

# nginx template (PORT substituted at startup)
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Supervisor config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Startup script
COPY start.sh /start.sh
RUN chmod +x /start.sh

# Cloud Run injects PORT at runtime (default 8080)
ENV PORT=8080

EXPOSE 8080

# Healthcheck must use $PORT
HEALTHCHECK CMD wget -q -O /dev/null http://localhost:${PORT} || exit 1

CMD ["/start.sh"]