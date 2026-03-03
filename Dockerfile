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

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker


# =========================
# 2. Runtime stage (Cloud Run)
# =========================
FROM nginx:1.27-alpine

# Cloud Run injects PORT at runtime (default 8080)
ENV PORT=8080

# Use nginx template system to bind to $PORT
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Static build output
COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html

# Optional but recommended
EXPOSE 8080

# Healthcheck must use $PORT
HEALTHCHECK CMD wget -q -O /dev/null http://localhost:${PORT} || exit 1

CMD ["nginx", "-g", "daemon off;"]