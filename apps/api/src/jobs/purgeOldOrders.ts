import { OrderStatus, PrismaClient } from "@prisma/client";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export type PurgeOldOrdersResult = {
  deletedOrders: number;
  deletedItems: number;
  cutoffDate: Date;
  retentionDays: number;
};

type PurgeOldOrdersOptions = {
  logger?: { info: (payload: Record<string, unknown>, message?: string) => void };
  retentionDays?: number;
  now?: Date;
};

const logInfo = (
  logger: PurgeOldOrdersOptions["logger"],
  message: string,
  payload: Record<string, unknown>
) => {
  if (!logger) {
    return;
  }

  logger.info(payload, message);
};

export const purgeOldOrders = async (
  prisma: PrismaClient,
  options: PurgeOldOrdersOptions = {}
): Promise<PurgeOldOrdersResult> => {
  const logger = options.logger;
  const retentionDays = options.retentionDays ?? 7;
  const now = options.now ?? new Date();
  const cutoffDate = new Date(now.getTime() - retentionDays * DAY_IN_MS);

  const oldOrders = await prisma.order.findMany({
    where: {
      createdAt: { lt: cutoffDate },
      status: { in: [OrderStatus.PRINTED] },
    },
    select: { id: true },
  });

  const ids = oldOrders.map((order) => order.id);

  if (ids.length === 0) {
    logInfo(logger, "purgeOldOrders: no orders to delete", {
      retentionDays,
      cutoffDate,
    });

    return {
      deletedOrders: 0,
      deletedItems: 0,
      cutoffDate,
      retentionDays,
    };
  }

  const [deletedItems, deletedOrders] = await prisma.$transaction([
    prisma.orderItem.deleteMany({
      where: { orderId: { in: ids } },
    }),
    prisma.order.deleteMany({
      where: { id: { in: ids } },
    }),
  ]);

  logInfo(logger, "purgeOldOrders: orders purged", {
    retentionDays,
    cutoffDate,
    deletedOrders: deletedOrders.count,
    deletedItems: deletedItems.count,
  });

  return {
    deletedOrders: deletedOrders.count,
    deletedItems: deletedItems.count,
    cutoffDate,
    retentionDays,
  };
};
