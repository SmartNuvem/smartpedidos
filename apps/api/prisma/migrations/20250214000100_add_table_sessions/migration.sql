-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "tableSessionId" TEXT;

-- AlterTable
ALTER TABLE "SalonTable" ADD COLUMN     "currentSessionId" TEXT;

-- CreateIndex
CREATE INDEX "Order_tableId_tableSessionId_idx" ON "Order"("tableId", "tableSessionId");
