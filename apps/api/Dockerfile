FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu \
  && rm -rf /var/lib/apt/lists/*

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN npm install --workspaces --include-workspace-root
RUN npm --workspace apps/api run prisma:generate

COPY apps/api/src ./apps/api/src

WORKDIR /app/apps/api

RUN npm run build
RUN grep -R "auth/admin" -n /app/apps/api/dist/server.js \
  && grep -R "admin/bootstrap" -n /app/apps/api/dist/server.js

EXPOSE 3000

CMD ["node", "dist/server.js"]
