-- CreateEnum
CREATE TYPE "PricingRule" AS ENUM ('SUM', 'MAX_OPTION');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "pricingRule" "PricingRule" NOT NULL DEFAULT 'SUM';
