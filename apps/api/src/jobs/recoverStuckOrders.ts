import { OrderStatus, PrismaClient } from "@prisma/client";

type RecoverStuckOrdersOptions = {
  logger?: { info: (payload: Record<string, unknown>, message?: string) => void };
  now?: Date;
  thresholdMinutes?: number;
};

export type RecoverStuckOrdersResult = {
  recoveredOrders: number;
  cutoffDate: Date;
  thresholdMinutes: number;
};

const logInfo = (
  logger: RecoverStuckOrdersOptions["logger"],
  message: string,
  payload: Record<string, unknown>
) => {
  if (!logger) {
    return;
  }

  logger.info(payload, message);
};

export const recoverStuckOrders = async (
  prisma: PrismaClient,
  options: RecoverStuckOrdersOptions = {}
): Promise<RecoverStuckOrdersResult> => {
  const logger = options.logger;
  const now = options.now ?? new Date();
  const thresholdMinutes = options.thresholdMinutes ?? 1;
  const cutoffDate = new Date(now.getTime() - thresholdMinutes * 60 * 1000);

  const updated = await prisma.order.updateMany({
    where: {
      status: OrderStatus.NEW,
      createdAt: { lte: cutoffDate },
      printingClaimedAt: null,
    },
    data: {
      status: OrderStatus.PRINTING,
      printingClaimedAt: now,
    },
  });

  logInfo(logger, "recoverStuckOrders: execution complete", {
    recoveredOrders: updated.count,
    cutoffDate,
    thresholdMinutes,
  });

  return {
    recoveredOrders: updated.count,
    cutoffDate,
    thresholdMinutes,
  };
};
