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

const ORDER_ITEMS_MAX_LINES = 40;

const defaultConfirmationTemplate = [
  "✅ Pedido {orderNumber} confirmado!",
  "{createdAtLine}",
  "Tipo: {fulfillmentLabel}",
  "Cliente: {customerName}",
  "{customerPhoneLine}",
  "{addressBlock}",
  "{notesLine}",
  "Itens:",
  "{itemsBlock}",
  "{totalBlock}",
  "{paymentBlock}",
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
      table: {
        select: { number: true },
      },
      items: {
        include: {
          product: { select: { name: true } },
          options: { select: { groupName: true, itemName: true } },
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
  const isTableOrder = Boolean(order.tableId || order.table?.number);
  const isDelivery = order.fulfillmentType === "DELIVERY" || order.orderType === "DELIVERY";
  const fulfillmentLabel = isTableOrder
    ? `Mesa ${order.table?.number ?? ""}`.trim()
    : isDelivery
      ? "Entrega"
      : "Retirada";

  const totalCents = Math.round(Number(order.total) * 100);
  const subtotalCents = Math.max(
    0,
    totalCents - Math.max(0, order.deliveryFeeCents) - Math.max(0, order.convenienceFeeCents)
  );

  const itemsLines = order.items.flatMap((item) => {
    const base = `${item.quantity}x ${item.product.name}`;
    const optionLines = item.options.map((option) => `   + ${option.itemName}`);
    const notesLine = item.notes?.trim() ? [`   obs: ${item.notes.trim()}`] : [];
    return [base, ...optionLines, ...notesLine];
  });

  const shouldTruncateItems = itemsLines.length > ORDER_ITEMS_MAX_LINES;
  const itemsBlock = itemsLines.length === 0
    ? "-"
    : shouldTruncateItems
      ? `${itemsLines.slice(0, ORDER_ITEMS_MAX_LINES).join("\n")}\n(...mais itens no pedido)`
      : itemsLines.join("\n");

  const addressParts = [
    [order.addressLine, order.addressNumber].filter(Boolean).join(", ").trim(),
    order.addressNeighborhood,
    order.addressCity,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);

  const addressBlock =
    isDelivery && addressParts.length > 0
      ? [
          "Endereço:",
          ...addressParts,
          order.addressReference?.trim() ? `Ref.: ${order.addressReference.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  const createdAtLine = `Data: ${new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(order.createdAt)}`;

  const paymentLines = [`Pagamento: ${formatPaymentMethod(order.paymentMethod)}`];
  if (order.paymentMethod === PaymentMethod.CASH && order.changeForCents != null) {
    paymentLines.push(`Troco para: ${formatCurrencyCents(order.changeForCents)}`);
  }
  const paymentBlock = paymentLines.join("\n");

  const totalLines = [`Total: ${formatCurrencyCents(totalCents)}`];
  if (subtotalCents > 0) {
    totalLines.unshift(`Subtotal: ${formatCurrencyCents(subtotalCents)}`);
  }
  if (order.deliveryFeeCents > 0) {
    totalLines.splice(totalLines.length - 1, 0, `Entrega: ${formatCurrencyCents(order.deliveryFeeCents)}`);
  }
  if (order.convenienceFeeCents > 0) {
    totalLines.splice(
      totalLines.length - 1,
      0,
      `${order.convenienceFeeLabel?.trim() || "Taxa de conveniência"}: ${formatCurrencyCents(order.convenienceFeeCents)}`
    );
  }
  const totalBlock = totalLines.join("\n");

  const receiptUrl =
    botConfig.sendReceiptLink && order.receiptToken ? buildReceiptUrl(order.id, order.receiptToken) : "";

  const message = replaceTemplate(botConfig.orderTemplate || defaultConfirmationTemplate, {
    storeName: order.store.name,
    orderNumber: orderCode,
    orderCode,
    fulfillmentType: fulfillmentLabel,
    fulfillmentLabel,
    itemsSummary: itemsBlock,
    itemsBlock,
    addressBlock,
    paymentBlock,
    totalBlock,
    createdAtLine,
    customerName: order.customerName?.trim() || "Cliente",
    customerPhoneLine: order.customerPhone?.trim() ? `Telefone: ${order.customerPhone.trim()}` : "",
    notesLine: order.notes?.trim() ? `Observações: ${order.notes.trim()}` : "",
    total: formatCurrencyCents(totalCents),
    paymentMethod: formatPaymentMethod(order.paymentMethod),
    addressLine: order.addressLine?.trim() || "",
    addressNumber: order.addressNumber?.trim() || "",
    addressNeighborhood: order.addressNeighborhood?.trim() || "",
    addressCity: order.addressCity?.trim() || "",
    addressReference: order.addressReference?.trim() || "",
    notes: order.notes?.trim() || "",
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
