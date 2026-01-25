FROM node:20-alpine

WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN npm install --workspaces --include-workspace-root
RUN npm --workspace apps/api run prisma:generate

COPY apps/api/src ./apps/api/src

WORKDIR /app/apps/api

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
