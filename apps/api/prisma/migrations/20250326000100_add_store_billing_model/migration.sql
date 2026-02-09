-- CreateEnum
CREATE TYPE "BillingModel" AS ENUM ('MONTHLY', 'PER_ORDER');

-- AlterTable
ALTER TABLE "Store"
ADD COLUMN     "billingModel" "BillingModel" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "monthlyPriceCents" INTEGER,
ADD COLUMN     "perOrderFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "showFeeOnPublicMenu" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "feeLabel" TEXT NOT NULL DEFAULT 'Taxa de conveniência do app';

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN     "convenienceFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "convenienceFeeLabel" TEXT;
