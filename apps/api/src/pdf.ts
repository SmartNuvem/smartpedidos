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

  doc.fontSize(14).text(order.store.name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(10).text(`Pedido: ${order.id}`);
  doc.text(`Data: ${formatDate(order.createdAt)}`);
  doc.moveDown(0.5);
  doc.text("Itens:");
  doc.moveDown(0.2);

  order.items.forEach((item) => {
    const lineTotal = item.price.mul(item.qty);
    doc.text(`${item.qty}x ${item.product.name}`);
    doc.text(currency.format(lineTotal.toNumber()), { align: "right" });
    doc.moveDown(0.2);
  });

  doc.moveDown(0.5);
  doc.fontSize(12).text(`Total: ${currency.format(order.total.toNumber())}`, {
    align: "right",
  });

  doc.end();
  return doc;
};
