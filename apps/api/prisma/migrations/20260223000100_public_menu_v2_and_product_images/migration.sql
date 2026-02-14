-- CreateEnum
CREATE TYPE "PublicMenuLayout" AS ENUM ('CLASSIC', 'V2');

-- AlterTable
ALTER TABLE "Store"
ADD COLUMN "publicMenuLayout" "PublicMenuLayout" NOT NULL DEFAULT 'CLASSIC';

-- AlterTable
ALTER TABLE "Product"
ADD COLUMN "imageKey" TEXT,
ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isOnSale" BOOLEAN NOT NULL DEFAULT false;
