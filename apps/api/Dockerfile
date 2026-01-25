FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json

RUN npm install --workspaces=false --prefix apps/api && \
    npm install --prefix apps/api

COPY apps/api ./apps/api

WORKDIR /app/apps/api

RUN npm run build

EXPOSE 3333

CMD ["npm", "run", "start"]
