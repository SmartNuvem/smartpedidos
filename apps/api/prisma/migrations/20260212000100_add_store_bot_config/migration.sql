-- CreateEnum
CREATE TYPE "StoreBotStatus" AS ENUM ('DISCONNECTED', 'WAITING_QR', 'CONNECTED');

-- CreateTable
CREATE TABLE "StoreBotConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instanceName" TEXT NOT NULL,
    "status" "StoreBotStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "connectedPhone" TEXT,
    "keywords" TEXT NOT NULL DEFAULT 'cardapio,menu',
    "sendMenuOnKeywords" BOOLEAN NOT NULL DEFAULT true,
    "sendOrderConfirmation" BOOLEAN NOT NULL DEFAULT true,
    "sendReceiptLink" BOOLEAN NOT NULL DEFAULT true,
    "pixMessageEnabled" BOOLEAN NOT NULL DEFAULT true,
    "menuTemplate" TEXT NOT NULL DEFAULT E'Olá! 👋\n\nAqui está o cardápio da {storeName}:\n{menuUrl}',
    "orderTemplate" TEXT NOT NULL DEFAULT E'Pedido {orderCode} confirmado ✅\nTotal: {total}\nComprovante: {receiptUrl}',
    "pixTemplate" TEXT NOT NULL DEFAULT 'Pagamento via PIX disponível. Se precisar, envie o comprovante por aqui.',
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreBotConfig_storeId_key" ON "StoreBotConfig"("storeId");

-- AddForeignKey
ALTER TABLE "StoreBotConfig" ADD CONSTRAINT "StoreBotConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill
INSERT INTO "StoreBotConfig" ("id", "storeId", "instanceName", "updatedAt")
SELECT gen_random_uuid()::text, s."id", s."slug", NOW()
FROM "Store" s
ON CONFLICT ("storeId") DO NOTHING;
