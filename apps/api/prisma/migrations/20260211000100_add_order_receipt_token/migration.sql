-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "receiptToken" VARCHAR(64);

-- Backfill existing orders
UPDATE "Order"
SET "receiptToken" = substr(md5(random()::text || clock_timestamp()::text), 1, 32)
WHERE "receiptToken" IS NULL;

-- Enforce required after backfill
ALTER TABLE "Order"
ALTER COLUMN "receiptToken" SET NOT NULL;
