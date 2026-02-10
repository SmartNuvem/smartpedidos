import PDFDocument from "pdfkit";
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
