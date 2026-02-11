# Migração segura de `Order.receiptToken`

Para evitar reset do banco no `prisma db push`, faça em 3 etapas:

1. **Schema temporariamente opcional** (`String?`) e `prisma db push`.
2. **Backfill em produção**:

```sql
UPDATE "Order"
SET "receiptToken" = substr(md5(random()::text || clock_timestamp()::text), 1, 32)
WHERE "receiptToken" IS NULL;
```

3. **Schema como obrigatório** (`String`) e novo `prisma db push`.

## Observação

O backend já preenche `receiptToken` na criação do pedido e o schema Prisma também tem `@default(uuid())` para reforçar a geração em novos registros.
