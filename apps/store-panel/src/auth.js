const TOKEN_KEY = "storeToken";
const ADMIN_TOKEN_KEY = "admin_token";
const WAITER_TOKEN_KEY = "waiter_token";
const WAITER_SLUG_KEY = "waiter_slug";

export const getToken = () => localStorage.getItem(TOKEN_KEY);

export const setToken = (token) => {
  localStorage.setItem(TOKEN_KEY, token);
};

export const clearToken = () => {
  localStorage.removeItem(TOKEN_KEY);
};

export const logout = (navigate) => {
  clearToken();
  if (typeof navigate === "function") {
    navigate("/login", { replace: true });
  } else if (typeof window !== "undefined") {
    window.location.assign("/login");
  }
};

export const getAdminToken = () => localStorage.getItem(ADMIN_TOKEN_KEY);

export const setAdminToken = (token) => {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
};

export const clearAdminToken = () => {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
};

export const getWaiterToken = () => localStorage.getItem(WAITER_TOKEN_KEY);

export const setWaiterToken = (token) => {
  localStorage.setItem(WAITER_TOKEN_KEY, token);
};

export const clearWaiterToken = () => {
  localStorage.removeItem(WAITER_TOKEN_KEY);
};

export const getWaiterSlug = () => localStorage.getItem(WAITER_SLUG_KEY);

export const setWaiterSlug = (slug) => {
  if (slug) {
    localStorage.setItem(WAITER_SLUG_KEY, slug);
  }
};

export const clearWaiterSlug = () => {
  localStorage.removeItem(WAITER_SLUG_KEY);
};

export const clearWaiterSession = () => {
  clearWaiterToken();
  clearWaiterSlug();
};
