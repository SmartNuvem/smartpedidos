-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "receiptToken" TEXT NOT NULL DEFAULT gen_random_uuid();
