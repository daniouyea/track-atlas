FROM node:24-slim AS base
WORKDIR /app

# --- Desarrollo: el código se monta como volumen ---
FROM base AS dev
RUN mkdir -p /app/node_modules && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["sh", "-c", "npm install && npm run dev -- --host 0.0.0.0 --port 3000"]

# --- Build de producción ---
FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Imagen final (Coolify) ---
FROM base AS prod
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 HOST=0.0.0.0
COPY --from=build /app/.output ./.output
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
