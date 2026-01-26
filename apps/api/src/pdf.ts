import PDFDocument from "pdfkit";
import { Order, OrderItem, Product, Store } from "@prisma/client";

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);

export type OrderReceipt = Order & {
  store: Store;
  items: Array<OrderItem & { product: Product }>;
};

export const buildOrderPdf = (order: OrderReceipt) => {
  const doc = new PDFDocument({
    size: [226, 1000],
    margins: { top: 10, bottom: 10, left: 10, right: 10 },
  });

  const fulfillmentLabel =
    order.fulfillmentType === "DELIVERY" ? "ENTREGA" : "RETIRAR";

  doc.fontSize(14).text(order.store.name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Pedido: ${order.id}`);
  doc.text(`Data: ${formatDate(order.createdAt)}`);
  doc.text(`Cliente: ${order.customerName}`);
  doc.text(`Telefone: ${order.customerPhone}`);
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
    if (order.addressReference) {
      doc.text(`Referência: ${order.addressReference}`);
    }
  }

  doc.moveDown(0.5);
  doc.text("Itens:");
  doc.moveDown(0.2);

  order.items.forEach((item) => {
    const lineTotalCents = item.unitPriceCents * item.quantity;
    doc.text(`${item.quantity}x ${item.product.name}`);
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
  doc.fontSize(12).text(`Total: ${currency.format(order.total.toNumber())}`, {
    align: "right",
  });

  doc.end();
  return doc;
};
