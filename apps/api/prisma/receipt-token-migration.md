# Migração segura de `Order.receiptToken`

Para evitar reset do banco no `prisma db push`, faça em 3 etapas:

1. **Schema temporariamente opcional** (`String?`) e `prisma db push`.
2. **Backfill em produção**:

```sql
UPDATE "Order"
SET "receiptToken" = substr(md5(random()::text || clock_timestamp()::text), 1, 32)
WHERE "receiptToken" IS NULL;
```

3. **Validar backfill**:

```sql
SELECT COUNT(*) FROM "Order" WHERE "receiptToken" IS NULL;
```

> O resultado deve ser `0`.

4. **Opcional, após validar**: tornar o campo obrigatório (`String`) e executar novo `prisma db push`.

## Observação

O backend já preenche `receiptToken` na criação do pedido, sem depender de default no Prisma.
