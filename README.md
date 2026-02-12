# SmartPedidos

Monorepo do SmartPedidos com API Fastify + Prisma e placeholders para Web Admin e Agent Windows.

## Subindo com Docker Compose (VM zerada)

```bash
cp .env.example .env
docker compose up -d --build
```

A API estará disponível em `http://localhost:3000` e o painel da loja em `http://localhost:5173`.

> Dentro do Docker, o host do banco deve ser `db` (como está no `.env.example`). Para rodar na máquina host sem Docker, ajuste o `DATABASE_URL` para usar `localhost`.
>
> **Nota sobre lockfiles:** este repositório usa workspaces npm e não versiona `package-lock.json`. Se sua infraestrutura exigir lockfiles, adicione-os no seu pipeline interno.

### Configuração de ambiente (VM zerada)

Edite o arquivo `.env` e ajuste:

- `VITE_API_URL`: URL pública da API acessível pelo navegador. Em produção atrás do Traefik, use `VITE_API_URL=/api` para manter o mesmo domínio do painel (ex.: `https://smartpedidos.smartnuvem.com.br`).
- `VITE_API_PROXY_TARGET`: usado apenas no dev server do Vite quando `VITE_API_URL=/api` (ex.: `http://api:3000` no Docker ou `http://localhost:3000` fora do Docker).
- `CORS_ORIGIN`: origem permitida do painel (ex.: `http://192.168.2.63:5173`). Aceita lista separada por vírgula.
- `COOKIE_DOMAIN`: domínio do cookie de sessão da loja (ex.: `.smartnuvem.com.br` para compartilhar entre painel e API).
- `COOKIE_SAMESITE`: controle de SameSite do cookie (`none`, `lax` ou `strict`). Em produção o padrão é `none`.
- `MAINTENANCE_TOKEN`: token usado para autorizar rotinas internas de manutenção (ex.: limpeza automática de pedidos antigos).
- `EVOLUTION_BASE_URL`: URL base da Evolution API/Manager (ex.: `https://evolution.seudominio.com`).
- `EVOLUTION_API_KEY`: chave da Evolution usada nas rotas de instância/webhook.
- `NOTIFY_PRINTED_ORDERS_INTERVAL_MS`: intervalo do job de retentativa de notificações WhatsApp para pedidos `PRINTED` (padrão: `60000`).
- `ACTIVEPIECES_INCOMING_WEBHOOK_URL`: webhook central do Activepieces para recebimento das mensagens da Evolution.

Se preferir, deixe `VITE_API_URL=/api` para usar o proxy do Vite (útil no Docker). Nesse caso, a URL externa do painel continua `http://IP:5173`.

Em produção, o Traefik deve rotear `PathPrefix(/api)` para o serviço `api:3000` com `stripPrefix`, garantindo que o painel acesse a API por `/api` no mesmo domínio.

## Limpeza automática de pedidos antigos

A API expõe um endpoint interno protegido para remover pedidos antigos com status `PRINTED` (por padrão, com mais de 7 dias):

```
POST /internal/maintenance/purge-old-orders
```

Exemplo de chamada manual:

```bash
curl -X POST http://localhost:3000/internal/maintenance/purge-old-orders \
  -H 'x-maintenance-token: change-me'
```

Para rodar automaticamente, configure um cron externo (ex.: 1x por dia) chamando o endpoint com o `MAINTENANCE_TOKEN` configurado no `.env`.

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

## Criando loja e login (bootstrap)

Crie uma loja via endpoint administrativo:

```bash
curl -X POST http://localhost:3000/admin/stores \
  -H 'Content-Type: application/json' \
  -H 'x-bootstrap-token: change-me' \
  -d '{"name":"Padaria Central","slug":"padaria-central","email":"loja@exemplo.com","password":"123456"}'
```

Faça login no painel com as credenciais:

```bash
curl -X POST http://localhost:3000/auth/store/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"loja@exemplo.com","password":"123456"}'
```

Verifique os dados da loja logada:

```bash
curl http://localhost:3000/store/me \
  -H 'Authorization: Bearer TOKEN_AQUI'
```

## Troubleshooting

### Validar rotas admin no build

Após o build dentro do container, confirme que o bundle contém as rotas admin:

```bash
grep -R "admin/bootstrap" -n /app/apps/api/dist/server.js
grep -R "auth/admin" -n /app/apps/api/dist/server.js
```

### `api:3000` não resolve no navegador

Se o console do navegador mostrar `ERR_NAME_NOT_RESOLVED` para `api:3000`, defina `VITE_API_URL` com a URL pública da API (`http://IP:3000`) ou use `VITE_API_URL=/api` com `VITE_API_PROXY_TARGET` apontando para a API no Docker.

### SSE (tempo real)

Para SSE funcionar em produção com painel e API em domínios diferentes, configure `COOKIE_DOMAIN` para o domínio raiz (ex.: `.smartnuvem.com.br`) e use `CORS_ORIGIN` com a URL do painel. O painel deve usar `/api` para manter o mesmo domínio ao abrir o stream.

Exemplo de validação via curl:

```bash
curl -i -c cookies.txt -X POST https://smartpedidos.smartnuvem.com.br/api/auth/store/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"loja@exemplo.com","password":"123456"}'

curl -i -b cookies.txt https://smartpedidos.smartnuvem.com.br/api/store/orders/stream
```

Em outro terminal, crie um pedido público e observe o evento chegar no stream:

```bash
curl -X POST https://smartpedidos.smartnuvem.com.br/api/public/padaria-central/orders \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"33333333-3333-3333-3333-333333333333","qty":2}]}'
```

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


## WhatsApp automático ao imprimir pedido

Quando um pedido muda para `PRINTED`, a API tenta enviar confirmação para o cliente via Evolution usando a instância da própria loja (`Store.slug`).

Pré-requisitos:
- `EVOLUTION_BASE_URL` e `EVOLUTION_API_KEY` configurados.
- Bot da loja habilitado em `StoreBotConfig` (`enabled=true` e `sendOrderConfirmation=true`).

Exemplo de teste manual (agente marcando pedido como impresso):

```bash
curl -X POST http://localhost:3000/agent/orders/ORDER_ID/printed \
  -H 'Authorization: Bearer super-token'
```

Retentativa automática:
- A API roda um job em background para reenviar notificações pendentes (`status=PRINTED` e `customerNotifiedAt IS NULL`) dos últimos 2 dias.
- Intervalo configurável por `NOTIFY_PRINTED_ORDERS_INTERVAL_MS`.
