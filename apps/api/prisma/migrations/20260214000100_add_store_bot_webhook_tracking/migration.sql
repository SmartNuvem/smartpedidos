ALTER TABLE "StoreBotConfig"
ADD COLUMN "webhookEnabled" BOOLEAN,
ADD COLUMN "webhookEvents" TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
ADD COLUMN "webhookAppliedAt" TIMESTAMP(3),
ADD COLUMN "lastWebhookError" TEXT;
