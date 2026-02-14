export const PUBLIC_PENDING_ORDER_KEY = "smartpedidos:public:pendingOrder";

const getStorage = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

export const readPendingPublicOrder = () => {
  const storage = getStorage();
  if (!storage) return null;
  const raw = storage.getItem(PUBLIC_PENDING_ORDER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const writePendingPublicOrder = (pendingOrder) => {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PUBLIC_PENDING_ORDER_KEY, JSON.stringify(pendingOrder));
};

export const removePendingPublicOrder = () => {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PUBLIC_PENDING_ORDER_KEY);
};
