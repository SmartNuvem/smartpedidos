# SmartPedidos

Monorepo do SmartPedidos com API Fastify + Prisma e placeholders para Web Admin e Agent Windows.

## Subindo com Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

A API estará disponível em `http://localhost:3000`.

> Dentro do Docker, o host do banco deve ser `db` (como está no `.env.example`). Para rodar na máquina host sem Docker, ajuste o `DATABASE_URL` para usar `localhost`.

## Criando o schema do banco (Prisma)

```bash
docker compose exec api sh -lc "cd /app/apps/api && npx prisma db push"
```

## Criando dados iniciais (PostgreSQL)

Como ainda não há endpoints administrativos, crie a loja, categorias, produtos e agente via SQL:

```bash
psql postgresql://postgres:postgres@localhost:5432/smartpedidos <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
INSERT INTO "Store" (id, name, slug, "createdAt", "updatedAt")
VALUES ('11111111-1111-1111-1111-111111111111', 'Padaria Central', 'padaria-central', now(), now());

INSERT INTO "Category" (id, name, "storeId", "createdAt", "updatedAt")
VALUES ('22222222-2222-2222-2222-222222222222', 'Pães', '11111111-1111-1111-1111-111111111111', now(), now());

INSERT INTO "Product" (id, name, price, active, "categoryId", "createdAt", "updatedAt")
VALUES
  ('33333333-3333-3333-3333-333333333333', 'Pão Francês', 1.5, true, '22222222-2222-2222-2222-222222222222', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'Pão de Queijo', 3.0, true, '22222222-2222-2222-2222-222222222222', now(), now());

-- Token inicial para o agente (use o hash gerado abaixo)
-- Exemplo de token: super-token
INSERT INTO "Agent" (id, "storeId", "tokenHash", active, "createdAt", "updatedAt")
VALUES ('55555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', encode(digest('super-token', 'sha256'), 'hex'), true, now(), now());
SQL
```

> Para gerar o hash manualmente via psql, use `encode(digest('TOKEN', 'sha256'), 'hex')`.

## Fluxo completo (curl)

### 1) Cardápio público
```bash
curl http://localhost:3000/public/padaria-central/menu
```

### 2) Criar pedido público
```bash
curl -X POST http://localhost:3000/public/padaria-central/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"33333333-3333-3333-3333-333333333333","qty":2}]}'
```

### 3) Listar pedidos do agente (NEW)
```bash
curl http://localhost:3000/agent/orders?status=NEW \
  -H 'Authorization: Bearer super-token'
```

### 4) Atualizar status do pedido
```bash
curl -X PATCH http://localhost:3000/agent/orders/ORDER_ID \
  -H 'Authorization: Bearer super-token' \
  -H 'Content-Type: application/json' \
  -d '{"status":"PRINTING"}'
```

### 5) Gerar PDF do pedido
```bash
curl -o order.pdf http://localhost:3000/agent/orders/ORDER_ID/pdf \
  -H 'Authorization: Bearer super-token'
```

### 6) Rotacionar token do agente
```bash
curl -X POST http://localhost:3000/agent/rotate-agent-token \
  -H 'Authorization: Bearer super-token'
```
