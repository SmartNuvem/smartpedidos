import { getToken } from "./auth";

const rawApiUrl = import.meta.env.VITE_API_URL;
const normalizedApiUrl = rawApiUrl && rawApiUrl.trim() !== "" ? rawApiUrl.trim() : "/api";
const API_URL = normalizedApiUrl.endsWith("/")
  ? normalizedApiUrl.slice(0, -1)
  : normalizedApiUrl;

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
    const response = await fetch(`${API_URL}/auth/store/login`, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse(response);
  },
  getOrders: async ({ status } = {}) => {
    const query = status ? `?status=${status}` : "";
    const response = await fetch(`${API_URL}/store/orders${query}`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getOrder: async (id) => {
    const response = await fetch(`${API_URL}/store/orders/${id}`, {
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  reprintOrder: async (id) => {
    const response = await fetch(`${API_URL}/store/orders/${id}/reprint`, {
      method: "POST",
      headers: buildHeaders(),
    });
    return handleResponse(response);
  },
  getStore: async () => {
    const response = await fetch(`${API_URL}/store/me`, {
      headers: buildHeaders(),
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
