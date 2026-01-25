# SmartPedidos

Sistema de pedidos multi-cliente com agente de impressão local.

## Estrutura

```
smartpedidos/
├─ apps/
│  ├─ api/
│  ├─ web-admin/
│  └─ agent-win/
├─ packages/
│  └─ shared/
├─ infra/
├─ docker-compose.yml
├─ README.md
├─ .env.example
└─ .gitignore
```

## Backend (apps/api)

### Requisitos

- Node.js 20+
- Postgres

### Configuração

```bash
cp .env.example .env
```

### Desenvolvimento

```bash
npm install --prefix apps/api
npm run prisma:generate --prefix apps/api
npm run prisma:migrate --prefix apps/api
npm run dev --prefix apps/api
```

### Docker

```bash
docker-compose up --build
```

## Próximos passos

- Adicionar agente Windows e frontend.
- Completar instruções de produção.
