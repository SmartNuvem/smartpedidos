-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "receiptToken" VARCHAR(64);

-- Backfill existing orders
UPDATE "Order"
SET "receiptToken" = substr(md5(random()::text || clock_timestamp()::text), 1, 32)
WHERE "receiptToken" IS NULL;

-- Keep nullable in this migration for safe rollout (db push + backfill first).
