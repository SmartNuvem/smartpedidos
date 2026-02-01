-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('PICKUP', 'DELIVERY', 'DINE_IN');

-- AlterEnum
ALTER TYPE "FulfillmentType" ADD VALUE IF NOT EXISTS 'DINE_IN';

-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('FREE', 'OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "salonEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Store" ADD COLUMN     "salonTableCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "orderType" "OrderType" NOT NULL DEFAULT 'PICKUP';
ALTER TABLE "Order" ADD COLUMN     "tableId" TEXT;
ALTER TABLE "Order" ALTER COLUMN "customerName" DROP NOT NULL;
ALTER TABLE "Order" ALTER COLUMN "customerPhone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SalonTable" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "TableStatus" NOT NULL DEFAULT 'FREE',
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalonTable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalonTable_storeId_number_key" ON "SalonTable"("storeId", "number");

-- CreateIndex
CREATE INDEX "SalonTable_storeId_idx" ON "SalonTable"("storeId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "SalonTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalonTable" ADD CONSTRAINT "SalonTable_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
