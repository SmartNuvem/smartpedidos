import { getAdminToken, getToken, getWaiterToken } from "./auth";

const rawApiUrl = import.meta.env.VITE_API_URL;
const normalizedApiUrl =
  rawApiUrl && rawApiUrl.trim() !== "" ? rawApiUrl.trim() : "/api";
export const API_URL = normalizedApiUrl.endsWith("/")
  ? normalizedApiUrl.slice(0, -1)
  : normalizedApiUrl;

const request = (url, options = {}) =>
  fetch(url, {
    credentials: "include",
    ...options,
  });

const buildHeaders = (headers = {}) => {
  const token = getToken();
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }
  return baseHeaders;
};

const buildAdminHeaders = (headers = {}) => {
  const token = getAdminToken();
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }
  return baseHeaders;
};

const buildWaiterHeaders = (headers = {}) => {
  const token = getWaiterToken();
  const baseHeaders = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (token) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }
  return baseHeaders;
};

const handleResponse = async (response) => {
  if (response.ok) {
    if (response.status === 204) {
      return null;
    }
    return response.json();
  }

  const error = await response.json().catch(() => ({}));
  const message = error.message || "Erro inesperado";
  const err = new Error(message);
  err.status = response.status;
  throw err;
};

export const api = {
  login: async ({ email, password }) => {
    const response = await request(`${API_URL}/auth/store/login`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse(response);
  },
  logout: async () => {
    const response = await request(`${API_URL}/auth/store/logout`, {
      method: "POST",
    });
    return handleResponse(response);
  },
  waiterLogin: async (slug, pin) => {
    const response = await request(`${API_URL}/public/${slug}/waiter/login`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ pin }),
    });
    return handleResponse(response);
  },
  getOrders: async ({ status } = {}) => {
    const query = status ? `?status=${status}` : "";
    const response = await request(`${API_URL}/store/orders${query}`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getOrder: async (id) => {
    const response = await request(`${API_URL}/store/orders/${id}`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  markOrderPrinting: async (id) => {
    const response = await request(`${API_URL}/store/orders/${id}/printing`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify({}),
    });
    return handleResponse(response);
  },
  reprintOrder: async (id) => {
    const response = await request(`${API_URL}/store/orders/${id}/reprint`, {
      method: "POST",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getStore: async () => {
    const response = await request(`${API_URL}/store/me`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  updateStore: async (payload) => {
    const response = await request(`${API_URL}/store/me`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  updateStoreSettings: async (payload) => {
    const response = await request(`${API_URL}/store/settings`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  getStoreAgents: async () => {
    const response = await request(`${API_URL}/store/agents`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  createStoreAgent: async (payload) => {
    const response = await request(`${API_URL}/store/agents`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  rotateStoreAgentToken: async (id) => {
    const response = await request(`${API_URL}/store/agents/${id}/rotate-token`, {
      method: "POST",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  updateStoreAgent: async (id, payload) => {
    const response = await request(`${API_URL}/store/agents/${id}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  deleteStoreAgent: async (id) => {
    const response = await request(`${API_URL}/store/agents/${id}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getDeliveryAreas: async () => {
    const response = await request(`${API_URL}/store/delivery-areas`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  createDeliveryArea: async (payload) => {
    const response = await request(`${API_URL}/store/delivery-areas`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  updateDeliveryArea: async (id, payload) => {
    const response = await request(`${API_URL}/store/delivery-areas/${id}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  deleteDeliveryArea: async (id) => {
    const response = await request(`${API_URL}/store/delivery-areas/${id}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getStoreHours: async () => {
    const response = await request(`${API_URL}/store/settings/hours`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  updateStoreHours: async (payload) => {
    const response = await request(`${API_URL}/store/settings/hours`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  getPaymentSettings: async () => {
    const response = await request(`${API_URL}/store/settings/payment`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  updatePaymentSettings: async (payload) => {
    const response = await request(`${API_URL}/store/settings/payment`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  getSalonSettings: async () => {
    const response = await request(`${API_URL}/store/salon/settings`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  updateSalonSettings: async (payload) => {
    const response = await request(`${API_URL}/store/salon/settings`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  getSalonTables: async () => {
    const response = await request(`${API_URL}/store/salon/tables`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getSalonTable: async (id) => {
    const response = await request(`${API_URL}/store/salon/tables/${id}`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  openSalonTable: async (id) => {
    const response = await request(
      `${API_URL}/store/salon/tables/${id}/open`,
      {
        method: "POST",
        headers: buildHeaders(),
      }
    );
    return handleResponse(response);
  },
  closeSalonTable: async (id) => {
    const response = await request(
      `${API_URL}/store/salon/tables/${id}/close`,
      {
        method: "POST",
        headers: buildHeaders(),
      }
    );
    return handleResponse(response);
  },
  getWaiterSalonSettings: async () => {
    const response = await request(`${API_URL}/store/salon/settings`, {
      headers: buildWaiterHeaders(),
    });
    return handleResponse(response);
  },
  getWaiterSalonTables: async () => {
    const response = await request(`${API_URL}/store/salon/tables`, {
      headers: buildWaiterHeaders(),
    });
    return handleResponse(response);
  },
  getWaiterSalonTable: async (id) => {
    const response = await request(`${API_URL}/store/salon/tables/${id}`, {
      headers: buildWaiterHeaders(),
    });
    return handleResponse(response);
  },
  openWaiterSalonTable: async (id) => {
    const response = await request(
      `${API_URL}/store/salon/tables/${id}/open`,
      {
        method: "POST",
        headers: buildWaiterHeaders(),
      }
    );
    return handleResponse(response);
  },
  closeWaiterSalonTable: async (id) => {
    const response = await request(
      `${API_URL}/store/salon/tables/${id}/close`,
      {
        method: "POST",
        headers: buildWaiterHeaders(),
      }
    );
    return handleResponse(response);
  },
  getCategories: async () => {
    const response = await request(`${API_URL}/store/categories`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  createCategory: async ({ name }) => {
    const response = await request(`${API_URL}/store/categories`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ name }),
    });
    return handleResponse(response);
  },
  updateCategory: async (id, payload) => {
    const response = await request(`${API_URL}/store/categories/${id}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  getProducts: async () => {
    const response = await request(`${API_URL}/store/products`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  createProduct: async (payload) => {
    const response = await request(`${API_URL}/store/products`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  updateProduct: async (id, payload) => {
    const response = await request(`${API_URL}/store/products/${id}`, {
      method: "PATCH",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  deleteProduct: async (id) => {
    const response = await request(`${API_URL}/store/products/${id}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getProductOptionGroups: async (productId) => {
    const response = await request(
      `${API_URL}/store/products/${productId}/option-groups`,
      {
        headers: buildHeaders(),
      }
    );
    return handleResponse(response);
  },
  createProductOptionGroup: async (productId, payload) => {
    const response = await request(
      `${API_URL}/store/products/${productId}/option-groups`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      }
    );
    return handleResponse(response);
  },
  updateOptionGroup: async (groupId, payload) => {
    const response = await request(`${API_URL}/store/option-groups/${groupId}`, {
      method: "PUT",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  deleteOptionGroup: async (groupId) => {
    const response = await request(`${API_URL}/store/option-groups/${groupId}`, {
      method: "DELETE",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getOptionGroupItems: async (groupId) => {
    const response = await request(
      `${API_URL}/store/option-groups/${groupId}/items`,
      {
        headers: buildHeaders(),
      }
    );
    return handleResponse(response);
  },
  createOptionGroupItem: async (groupId, payload) => {
    const response = await request(
      `${API_URL}/store/option-groups/${groupId}/items`,
      {
        method: "POST",
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      }
    );
    return handleResponse(response);
  },
  updateOptionGroupItem: async (groupId, itemId, payload) => {
    const response = await request(
      `${API_URL}/store/option-groups/${groupId}/items/${itemId}`,
      {
        method: "PUT",
        headers: buildHeaders(),
        body: JSON.stringify(payload),
      }
    );
    return handleResponse(response);
  },
  deleteOptionGroupItem: async (groupId, itemId) => {
    const response = await request(
      `${API_URL}/store/option-groups/${groupId}/items/${itemId}`,
      {
        method: "DELETE",
        headers: buildHeaders(),
      }
    );
    return handleResponse(response);
  },
};

export const adminApi = {
  login: async ({ email, password }) => {
    const response = await request(`${API_URL}/auth/admin/login`, {
      method: "POST",
      headers: buildAdminHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse(response);
  },
  getStores: async () => {
    const response = await request(`${API_URL}/admin/stores`, {
      headers: buildAdminHeaders(),
    });
    return handleResponse(response);
  },
  getStoreWeekStats: async (id) => {
    const response = await request(
      `${API_URL}/admin/stores/${id}/stats/week`,
      {
        headers: buildAdminHeaders(),
      }
    );
    return handleResponse(response);
  },
  createStore: async (payload) => {
    const response = await request(`${API_URL}/admin/stores`, {
      method: "POST",
      headers: buildAdminHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  updateStore: async (id, payload) => {
    const response = await request(`${API_URL}/admin/stores/${id}`, {
      method: "PATCH",
      headers: buildAdminHeaders(),
      body: JSON.stringify(payload),
    });
    return handleResponse(response);
  },
  resetStorePassword: async (id, password) => {
    const response = await request(
      `${API_URL}/admin/stores/${id}/reset-password`,
      {
        method: "POST",
        headers: buildAdminHeaders(),
        body: JSON.stringify({ password }),
      }
    );
    return handleResponse(response);
  },
  deleteStore: async (id) => {
    const response = await request(`${API_URL}/admin/stores/${id}`, {
      method: "DELETE",
      headers: buildAdminHeaders(),
    });
    return handleResponse(response);
  },
};

export const formatCurrency = (value) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value ?? 0));

export const formatDateTime = (value) => {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString("pt-BR");
};

export const formatDecimal = (value) => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return Number(value).toFixed(2).replace(".", ",");
};
