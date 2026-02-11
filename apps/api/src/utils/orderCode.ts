export const getOrderCode = (id: string) =>
  id.replace(/-/g, "").slice(0, 6).toLowerCase();

