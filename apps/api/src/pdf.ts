import PDFDocument from "pdfkit";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import {
  Order,
  OrderItem,
  OrderItemOption,
  Product,
  Store,
} from "@prisma/client";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);

const formatDateOnly = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);

export type OrderReceipt = Order & {
  store: Store;
  items: Array<OrderItem & { product: Product; options?: OrderItemOption[] }>;
};

export type TableSummaryItem = {
  name: string;
  quantity: number;
  totalCents: number;
};

export type TableSummaryReceipt = {
  store: Store;
  tableNumber: number;
  items: TableSummaryItem[];
  totalCents: number;
  closedAt?: Date | null;
};

export type BillingReport = {
  store: Pick<
    Store,
    "id" | "name" | "feeLabel" | "perOrderFeeCents" | "billingModel"
  >;
  from: Date;
  to: Date;
  ordersCount: number;
  totalCents: number;
  generatedAt: Date;
};

export type RevenueReport = {
  store: Pick<Store, "name" | "slug">;
  rangeLabel: string;
  periodLabel: string;
  ordersCount: number;
  revenueCents: number;
  averageTicketCents: number;
  generatedAt: Date;
};

export type PublicOrderReceiptPdfData = Pick<
  Order,
  | "id"
  | "createdAt"
  | "notes"
  | "paymentMethod"
  | "fulfillmentType"
  | "addressLine"
  | "addressNumber"
  | "addressNeighborhood"
  | "addressCity"
  | "addressReference"
  | "deliveryFeeCents"
  | "convenienceFeeCents"
  | "convenienceFeeLabel"
  | "changeForCents"
  | "total"
> & {
  shortCode?: string | null;
  store: Pick<Store, "name">;
  items: Array<OrderItem & { product: Product; options?: OrderItemOption[] }>;
};

type ReceiptTextLine = {
  align?: "left" | "center";
  fontSize?: number;
  text: string;
};

const orderShortCode = (order: PublicOrderReceiptPdfData) =>
  order.shortCode?.trim() || order.id.slice(-6);

const buildPublicReceiptLines = (order: PublicOrderReceiptPdfData): ReceiptTextLine[] => {
  const paymentLabels = {
    PIX: "PIX",
    CASH: "Dinheiro",
    CARD: "Cartão",
  } as const;

  const fulfillmentLabels = {
    DELIVERY: "Entrega",
    PICKUP: "Retirada",
    DINE_IN: "Consumo no local",
  } as const;

  const lines: ReceiptTextLine[] = [
    {
      text: order.store?.name?.trim() || "Restaurante",
      align: "center",
      fontSize: 15,
    },
    {
      text: "Comprovante do pedido",
      align: "center",
      fontSize: 11,
    },
    { text: `Pedido #${orderShortCode(order)}`, fontSize: 11 },
    { text: `Data: ${formatDate(order.createdAt)}` },
    { text: "" },
    { text: "Itens", fontSize: 11 },
  ];

  order.items.forEach((item) => {
    const lineTotalCents = item.unitPriceCents * item.quantity;
    lines.push({
      text: `${item.quantity}x ${item.product.name} — ${currency.format(lineTotalCents / 100)}`,
    });

    item.options?.forEach((option) => {
      const optionPrice =
        option.priceDeltaCents > 0
          ? ` (+${currency.format(option.priceDeltaCents / 100)})`
          : "";
      lines.push({ text: `  • ${option.groupName}: ${option.itemName}${optionPrice}` });
    });

    if (item.notes) {
      lines.push({ text: `  Obs. item: ${item.notes}` });
    }
  });

  if (order.notes) {
    lines.push({ text: "" }, { text: `Observações: ${order.notes}` });
  }

  lines.push(
    { text: "" },
    { text: `Pagamento: ${paymentLabels[order.paymentMethod] ?? "Não informado"}` },
    { text: `Tipo: ${fulfillmentLabels[order.fulfillmentType] ?? "Não informado"}` }
  );

  if (order.fulfillmentType === "DELIVERY") {
    const address = [
      order.addressLine,
      order.addressNumber,
      order.addressNeighborhood,
      order.addressCity,
    ]
      .filter(Boolean)
      .join(", ");
    if (address) {
      lines.push({ text: `Endereço: ${address}` });
    }
    if (order.addressReference) {
      lines.push({ text: `Referência: ${order.addressReference}` });
    }
  }

  if (order.paymentMethod === "CASH" && order.changeForCents && order.changeForCents > 0) {
    lines.push({ text: `Troco para: ${currency.format(order.changeForCents / 100)}` });
  }

  if (order.deliveryFeeCents > 0) {
    lines.push({ text: `Taxa de entrega: ${currency.format(order.deliveryFeeCents / 100)}` });
  }

  if (order.convenienceFeeCents > 0) {
    lines.push({
      text: `${order.convenienceFeeLabel || "Taxa"}: ${currency.format(order.convenienceFeeCents / 100)}`,
    });
  }

  lines.push({ text: `Total: ${currency.format(order.total.toNumber())}`, fontSize: 11 });

  if (lines.length === 0) {
    return [{ text: order.store?.name || "Comprovante" }, { text: `Pedido #${orderShortCode(order)}` }];
  }

  return lines;
};

export const buildOrderPdf = (order: OrderReceipt) => {
  const doc = new PDFDocument({
    size: [226, 1000],
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
  });

  const fulfillmentLabel =
    order.fulfillmentType === "DELIVERY"
      ? "ENTREGA"
      : order.fulfillmentType === "DINE_IN"
        ? "SALÃO"
        : "RETIRAR";
  const customerName = order.customerName ?? "-";
  const customerPhone = order.customerPhone ?? "-";

  doc.fontSize(14).text(order.store.name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Pedido: ${order.id}`);
  doc.text(`Data: ${formatDate(order.createdAt)}`);
  doc.text(`Cliente: ${customerName}`);
  doc.text(`Telefone: ${customerPhone}`);
  doc.text(`Tipo: ${fulfillmentLabel}`);

  if (order.fulfillmentType === "DELIVERY") {
    const address = [
      order.addressLine,
      order.addressNumber,
      order.addressNeighborhood,
      order.addressCity,
    ]
      .filter(Boolean)
      .join(", ");
    if (address) {
      doc.text(`Endereço: ${address}`);
    }
    if (order.addressNeighborhood) {
      doc.text(`Bairro: ${order.addressNeighborhood}`);
    }
    if (order.addressReference) {
      doc.text(`Referência: ${order.addressReference}`);
    }
  }

  const paymentLabels = {
    PIX: "PIX",
    CASH: "DINHEIRO",
    CARD: "CARTÃO",
  } as const;

  doc.text(`Pagamento: ${paymentLabels[order.paymentMethod] ?? "N/D"}`);
  if (order.paymentMethod === "CASH" && order.changeForCents) {
    doc.text(
      `Troco para: ${currency.format(order.changeForCents / 100)}`
    );
  }

  doc.moveDown(0.5);
  doc.text("Itens:");
  doc.moveDown(0.2);

  const subtotalCents = order.items.reduce(
    (acc, item) => acc + item.unitPriceCents * item.quantity,
    0
  );

  order.items.forEach((item) => {
    const lineTotalCents = item.unitPriceCents * item.quantity;
    doc.text(`${item.quantity}x ${item.product.name}`);
    if (item.options && item.options.length > 0) {
      doc.fontSize(8);
      item.options.forEach((option) => {
        const priceLabel =
          option.priceDeltaCents > 0
            ? ` (+${currency.format(option.priceDeltaCents / 100)})`
            : "";
        doc.text(`• ${option.groupName}: ${option.itemName}${priceLabel}`, {
          indent: 8,
        });
      });
      doc.fontSize(10);
    }
    if (item.notes) {
      doc.fontSize(8).text(`Obs: ${item.notes}`);
      doc.fontSize(10);
    }
    doc.text(currency.format(lineTotalCents / 100), { align: "right" });
    doc.moveDown(0.2);
  });

  if (order.notes) {
    doc.moveDown(0.3);
    doc.fontSize(9).text(`Observações: ${order.notes}`);
  }

  doc.moveDown(0.5);
  doc.moveDown(0.3);
  doc.fontSize(10).text(
    `Subtotal itens: ${currency.format(subtotalCents / 100)}`
  );
  if (order.deliveryFeeCents > 0) {
    doc.text(
      `Taxa entrega: ${currency.format(order.deliveryFeeCents / 100)}`
    );
  }
  if (order.convenienceFeeCents > 0) {
    const feeLabel =
      order.convenienceFeeLabel ?? "Taxa de conveniência do app";
    doc.text(
      `${feeLabel}: ${currency.format(order.convenienceFeeCents / 100)}`
    );
  }

  doc.fontSize(12).text(`Total: ${currency.format(order.total.toNumber())}`, {
    align: "right",
  });

  doc.end();
  return doc;
};

export const buildTableSummaryPdf = (summary: TableSummaryReceipt) => {
  const doc = new PDFDocument({
    size: [226, 1000],
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
  });

  doc.fontSize(14).text(summary.store.name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Mesa ${summary.tableNumber}`);
  if (summary.closedAt) {
    doc.fontSize(9).text(`Fechamento: ${formatDate(summary.closedAt)}`);
  }

  doc.moveDown(0.4);
  doc.fontSize(10).text("Resumo de itens:");
  doc.moveDown(0.2);

  if (summary.items.length === 0) {
    doc.text("Nenhum item encontrado.");
  } else {
    summary.items.forEach((item) => {
      doc.text(`${item.quantity}x ${item.name}`);
      doc.text(currency.format(item.totalCents / 100), { align: "right" });
      doc.moveDown(0.2);
    });
  }

  doc.moveDown(0.5);
  doc.fontSize(12).text(
    `Total: ${currency.format(summary.totalCents / 100)}`,
    { align: "right" }
  );

  doc.end();
  return doc;
};

export const buildBillingPdf = (report: BillingReport) => {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, bottom: 48, left: 48, right: 48 },
  });

  doc.fontSize(18).text("Relatório de cobrança", { align: "center" });
  doc.moveDown(1);

  doc.fontSize(12).text(`Loja: ${report.store.name} (${report.store.id})`);
  doc.text(
    `Período: ${formatDateOnly(report.from)} - ${formatDateOnly(report.to)}`
  );
  doc.text("Modelo: PER_ORDER");
  doc.text(
    `Texto da taxa: ${report.store.feeLabel ?? "Taxa de conveniência do app"}`
  );
  doc.text(
    `Taxa por pedido: ${currency.format(
      (report.store.perOrderFeeCents ?? 0) / 100
    )}`
  );
  doc.text(`Quantidade de pedidos: ${report.ordersCount}`);
  doc.text(
    `Total a pagar: ${currency.format(report.totalCents / 100)}`
  );
  doc.text(`Data de geração: ${formatDate(report.generatedAt)}`);

  doc.moveDown(4);
  doc.fontSize(10).text("SmartNuvem Informática", { align: "center" });

  doc.end();
  return doc;
};

export const buildRevenuePdf = (report: RevenueReport) => {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, bottom: 48, left: 48, right: 48 },
  });

  doc.fontSize(20).text("Relatório de Faturamento", { align: "center" });
  doc.moveDown(1);

  doc.fontSize(12).text(`Loja: ${report.store.name} (${report.store.slug})`);
  doc.text(`Período: ${report.rangeLabel}`);
  doc.text(`Datas: ${report.periodLabel}`);
  doc.moveDown(0.5);
  doc.text(`Total faturado: ${currency.format(report.revenueCents / 100)}`);
  doc.text(`Pedidos concluídos: ${report.ordersCount}`);
  doc.text(
    `Ticket médio: ${currency.format(report.averageTicketCents / 100)}`
  );
  doc.text(`Gerado em: ${formatDate(report.generatedAt)}`);

  doc.moveDown(4);
  doc.fontSize(10).text("SmartNuvem Informática", { align: "center" });

  doc.end();
  return doc;
};

export const buildPublicOrderReceiptPdf = (order: PublicOrderReceiptPdfData) => {
  const widthPts = 80 * 2.83464567;
  const lineHeight = 14;
  const padding = 16;
  const lines = buildPublicReceiptLines(order);
  const wrappedLineCount = lines.reduce((count, line) => {
    if (!line.text.trim()) {
      return count + 1;
    }
    return count + Math.max(1, Math.ceil(line.text.length / 34));
  }, 0);
  const heightPts = padding + wrappedLineCount * lineHeight + padding;

  const doc = new PDFDocument({
    size: [widthPts, heightPts],
    margins: { top: 12, bottom: 12, left: 12, right: 12 },
  });

  doc.font("Helvetica");
  lines.forEach((line, index) => {
    const isStoreName = index === 0;
    doc
      .fontSize(line.fontSize ?? (isStoreName ? 15 : 10))
      .text(line.text || " ", {
        align: line.align ?? (isStoreName ? "center" : "left"),
        lineGap: 2,
      });
  });

  doc.end();
  return doc;
};

const RECEIPT_FONT_FAMILY = "\"DejaVu Sans\", sans-serif";

type ReceiptPngEntry = {
  color?: string;
  fontSize: number;
  fontWeight?: "normal" | "bold";
  indent?: number;
  spacingAfter?: number;
  spacingBefore?: number;
  text: string;
};

const wrapCanvasText = (params: {
  context: SKRSContext2D;
  maxWidth: number;
  text: string;
}) => {
  const words = params.text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = params.context.measureText(candidate).width;
    if (candidateWidth <= params.maxWidth || !currentLine) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
};

export const buildPublicOrderReceiptPng = async (order: PublicOrderReceiptPdfData) => {
  const width = 720;
  const horizontalPadding = 40;
  const verticalPadding = 42;
  const maxTextWidth = width - horizontalPadding * 2;
  const lines = buildPublicReceiptLines(order);

  const entries: ReceiptPngEntry[] = (lines.length > 0
    ? lines
    : [{ text: order.store?.name || "Comprovante" }, { text: `Pedido #${orderShortCode(order)}` }]
  ).map((line, index) => ({
    text: line.text,
    fontSize: index === 0 ? 24 : 18,
    fontWeight: index === 0 ? "bold" : "normal",
    spacingAfter: 6,
  }));

  const measureCanvas = createCanvas(width, 10);
  const measureContext = measureCanvas.getContext("2d");

  let totalHeight = verticalPadding * 2;
  entries.forEach((entry) => {
    const fontWeight = entry.fontWeight ?? "normal";
    measureContext.font = `${fontWeight} ${entry.fontSize}px ${RECEIPT_FONT_FAMILY}`;
    const maxWidth = maxTextWidth - (entry.indent ?? 0);
    const wrappedLines = wrapCanvasText({
      context: measureContext,
      text: entry.text,
      maxWidth,
    });
    const lineHeight = entry.fontSize * 1.42;
    totalHeight += entry.spacingBefore ?? 0;
    totalHeight += wrappedLines.length * lineHeight;
    totalHeight += entry.spacingAfter ?? 0;
  });

  const canvas = createCanvas(width, Math.ceil(totalHeight));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, canvas.height);

  let y = verticalPadding;
  entries.forEach((entry) => {
    y += entry.spacingBefore ?? 0;
    const fontWeight = entry.fontWeight ?? "normal";
    context.font = `${fontWeight} ${entry.fontSize}px ${RECEIPT_FONT_FAMILY}`;
    context.fillStyle = entry.color ?? "#0f172a";
    context.textBaseline = "top";
    const lineHeight = entry.fontSize * 1.42;
    const indent = entry.indent ?? 0;
    const maxWidth = maxTextWidth - indent;
    const wrappedLines = wrapCanvasText({
      context,
      text: entry.text,
      maxWidth,
    });

    wrappedLines.forEach((line) => {
      context.fillText(line, horizontalPadding + indent, y, maxWidth);
      y += lineHeight;
    });

    y += entry.spacingAfter ?? 0;
  });

  return canvas.encode("png");
};
