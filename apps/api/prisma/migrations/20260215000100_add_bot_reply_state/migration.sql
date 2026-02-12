CREATE TABLE "BotReplyState" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "lastReplyAt" TIMESTAMP(3) NOT NULL,
    "lastReplyType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotReplyState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BotReplyState_storeId_number_key" ON "BotReplyState"("storeId", "number");

ALTER TABLE "BotReplyState" ADD CONSTRAINT "BotReplyState_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
