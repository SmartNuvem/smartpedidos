-- Add client idempotency key for public orders
ALTER TABLE "Order"
ADD COLUMN "clientOrderId" TEXT;

CREATE UNIQUE INDEX "Order_storeId_clientOrderId_key"
ON "Order"("storeId", "clientOrderId");
