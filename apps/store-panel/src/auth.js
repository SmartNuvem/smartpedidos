const TOKEN_KEY = "storeToken";
const ADMIN_TOKEN_KEY = "admin_token";

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
