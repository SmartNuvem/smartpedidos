-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "waiterPinHash" TEXT;
ALTER TABLE "Store" ADD COLUMN     "waiterPwaEnabled" BOOLEAN NOT NULL DEFAULT true;
