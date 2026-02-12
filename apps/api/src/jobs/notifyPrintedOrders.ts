import { OrderStatus, PrismaClient } from "@prisma/client";
import { notifyCustomerOnPrinted } from "../services/orderPrintedNotification";

type NotifyPrintedOrdersOptions = {
  logger?: {
    info: (payload: Record<string, unknown>, message?: string) => void;
    warn?: (payload: Record<string, unknown>, message?: string) => void;
    error: (payload: Record<string, unknown>, message?: string) => void;
  };
  now?: Date;
  lookbackDays?: number;
};

export const notifyPrintedOrders = async (
  prisma: PrismaClient,
  options: NotifyPrintedOrdersOptions = {}
) => {
  const logger = options.logger;
  const now = options.now ?? new Date();
  const lookbackDays = options.lookbackDays ?? 2;
  const cutoffDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      status: OrderStatus.PRINTED,
      customerNotifiedAt: null,
      customerPhone: { not: null },
      createdAt: { gte: cutoffDate },
    },
    select: { id: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  let sentCount = 0;

  for (const order of orders) {
    const result = await notifyCustomerOnPrinted(prisma, order.id, logger ?? console);
    if (result.sent) {
      sentCount += 1;
    }
  }

  logger?.info(
    {
      found: orders.length,
      sent: sentCount,
      lookbackDays,
      cutoffDate,
    },
    "notifyPrintedOrders: execution complete"
  );

  return {
    found: orders.length,
    sent: sentCount,
    lookbackDays,
    cutoffDate,
  };
};
