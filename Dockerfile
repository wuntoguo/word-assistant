# Stage 1: Build frontend
FROM node:20-slim AS build-frontend
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src/ src/
COPY public/ public/
RUN npm run build

# Stage 2: Build backend
FROM node:20-slim AS build-backend
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/tsconfig.json ./
COPY server/src/ src/
RUN npm run build

# Stage 3: Production
FROM node:20-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server production dependencies (includes native better-sqlite3 build)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy compiled backend
COPY --from=build-backend /app/server/dist ./server/dist

# Copy built frontend to client-dist (matches the path in index.ts)
COPY --from=build-frontend /app/dist ./client-dist

# Create data directory for SQLite
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3001
ENV DATABASE_PATH=/data/data.db

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "dist/index.js"]
