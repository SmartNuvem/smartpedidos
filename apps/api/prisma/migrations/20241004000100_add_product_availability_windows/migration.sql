ALTER TABLE "Store" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE TABLE "ProductAvailabilityWindow" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAvailabilityWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductAvailabilityWindow_productId_idx" ON "ProductAvailabilityWindow"("productId");

ALTER TABLE "ProductAvailabilityWindow" ADD CONSTRAINT "ProductAvailabilityWindow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
