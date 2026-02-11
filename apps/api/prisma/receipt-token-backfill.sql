UPDATE "Order"
SET "receiptToken" = substr(md5(random()::text || clock_timestamp()::text), 1, 32)
WHERE "receiptToken" IS NULL;

SELECT COUNT(*) FROM "Order" WHERE "receiptToken" IS NULL;
