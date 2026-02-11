export const getOrderCode = (id = "") =>
  id.toString().replace(/-/g, "").slice(0, 6).toLowerCase();

