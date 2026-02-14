-- CreateEnum
CREATE TYPE "ThemePreset" AS ENUM ('DEFAULT', 'SMARTPEDIDO');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "themePreset" "ThemePreset";
