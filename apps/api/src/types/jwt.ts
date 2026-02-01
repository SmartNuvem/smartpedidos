export interface JwtUser {
  id: string;
  role: "ADMIN" | "STORE" | "WAITER";
  storeId?: string;
  slug?: string;
}
