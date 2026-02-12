import { OrderStatus, PaymentMethod, PrismaClient } from "@prisma/client";
import { sendTextMessage } from "../evolution";
import { getOrderCode } from "../utils/orderCode";
import { normalizePhoneBR } from "../utils/phone";

type Logger = {
  info: (payload: Record<string, unknown>, msg?: string) => void;
  warn?: (payload: Record<string, unknown>, msg?: string) => void;
  error: (payload: Record<string, unknown>, msg?: string) => void;
};

const formatCurrencyCents = (amountCents: number) => `R$ ${(amountCents / 100).toFixed(2).replace(".", ",")}`;

const formatPaymentMethod = (paymentMethod: PaymentMethod) => {
  if (paymentMethod === PaymentMethod.CASH) {
    return "Dinheiro";
  }
  if (paymentMethod === PaymentMethod.CARD) {
    return "Cartão";
  }
  return "Pix";
};

const defaultConfirmationTemplate = [
  "✅ *{storeName}*",
  "Pedido *{orderNumber}* impresso e confirmado.",
  "Tipo: {fulfillmentType}",
  "Itens:",
  "{itemsSummary}",
  "Total: {total}",
  "Pagamento: {paymentMethod}",
  "{changeForLine}",
  "{receiptUrlLine}",
].join("\n");

const defaultPixTemplate = [
  "Pagamento via Pix:",
  "Chave: {pixKey}",
  "Favorecido: {pixName}",
  "Banco: {pixBank}",
].join("\n");

const replaceTemplate = (template: string, vars: Record<string, string>) => {
  let text = template;
  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${key}}`, value);
  }
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => {
      if (line.length > 0) return true;
      const prev = arr[index - 1] ?? "";
      return prev.length > 0;
    })
    .join("\n")
    .trim();
};

const buildReceiptUrl = (orderId: string, receiptToken: string) =>
  `https://smartpedido.com.br/api/public/orders/${orderId}/receipt.png?token=${encodeURIComponent(receiptToken)}`;

export const notifyCustomerOnPrinted = async (
  prisma: PrismaClient,
  orderId: string,
  logger: Logger
) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      store: {
        select: { id: true, slug: true, name: true },
      },
      items: {
        include: {
          product: { select: { name: true } },
          options: { select: { itemName: true } },
        },
      },
    },
  });

  if (!order) {
    logger.warn?.({ orderId }, "notifyCustomerOnPrinted: order not found");
    return { sent: false, reason: "not_found" };
  }

  if (order.status !== OrderStatus.PRINTED) {
    return { sent: false, reason: "status_not_printed" };
  }

  if (order.customerNotifiedAt) {
    return { sent: false, reason: "already_notified" };
  }

  if (order.tableId || order.fulfillmentType === "DINE_IN") {
    return { sent: false, reason: "dine_in" };
  }

  const normalizedPhone = normalizePhoneBR(order.customerPhone);
  if (!normalizedPhone) {
    return { sent: false, reason: "invalid_phone" };
  }

  const botConfig = await prisma.storeBotConfig.findUnique({ where: { storeId: order.storeId } });
  if (!botConfig || !botConfig.enabled || !botConfig.sendOrderConfirmation) {
    return { sent: false, reason: "bot_disabled" };
  }

  const orderCode = getOrderCode(order.id);
  const fulfillmentType = order.fulfillmentType === "DELIVERY" ? "Delivery" : "Retirada";
  const totalCents = Math.round(Number(order.total) * 100);
  const changeForLine =
    order.paymentMethod === PaymentMethod.CASH && order.changeForCents
      ? `Troco para ${formatCurrencyCents(order.changeForCents)}`
      : "";

  const itemsSummary = order.items
    .map((item) => {
      const base = `${item.quantity}x ${item.product.name}`;
      const options = item.options.map((option) => `+ ${option.itemName}`).join("; ");
      return options ? `${base}\n  ${options}` : base;
    })
    .join("\n");

  const receiptUrl =
    botConfig.sendReceiptLink && order.receiptToken ? buildReceiptUrl(order.id, order.receiptToken) : "";

  const message = replaceTemplate(botConfig.orderTemplate || defaultConfirmationTemplate, {
    storeName: order.store.name,
    orderNumber: orderCode,
    orderCode,
    fulfillmentType,
    itemsSummary,
    total: formatCurrencyCents(totalCents),
    paymentMethod: formatPaymentMethod(order.paymentMethod),
    changeForLine,
    receiptUrl,
    receiptUrlLine: receiptUrl ? `Comprovante: ${receiptUrl}` : "",
    menuUrl: `https://smartpedido.com.br/p/${order.store.slug}`,
  });

  if (!message) {
    return { sent: false, reason: "empty_message" };
  }

  try {
    await sendTextMessage(order.store.slug, normalizedPhone, message);

    if (order.paymentMethod === PaymentMethod.PIX && botConfig.pixMessageEnabled) {
      const paymentSettings = await prisma.storePaymentSettings.findUnique({
        where: { storeId: order.storeId },
      });

      if (paymentSettings?.pixKey) {
        const pixMessage = replaceTemplate(botConfig.pixTemplate || defaultPixTemplate, {
          storeName: order.store.name,
          orderNumber: orderCode,
          total: formatCurrencyCents(totalCents),
          paymentMethod: formatPaymentMethod(order.paymentMethod),
          receiptUrl,
          menuUrl: `https://smartpedido.com.br/p/${order.store.slug}`,
          pixKey: paymentSettings.pixKey,
          pixName: paymentSettings.pixName ?? "",
          pixBank: paymentSettings.pixBank ?? "",
        });

        if (pixMessage) {
          await sendTextMessage(order.store.slug, normalizedPhone, pixMessage);
        }
      }
    }

    await prisma.order.updateMany({
      where: {
        id: order.id,
        customerNotifiedAt: null,
      },
      data: {
        customerNotifiedAt: new Date(),
      },
    });

    return { sent: true, reason: "sent" };
  } catch (error) {
    logger.error(
      {
        err: error,
        orderId: order.id,
        storeSlug: order.store.slug,
      },
      "notifyCustomerOnPrinted: failed to send whatsapp"
    );
    return { sent: false, reason: "send_failed" };
  }
};
