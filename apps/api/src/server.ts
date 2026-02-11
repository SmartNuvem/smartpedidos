import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import cors from "@fastify/cors";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "crypto";
import {
  OpenOverride,
  OrderStatus,
  OrderType,
  Prisma,
  type PrismaClient,
  PrintJobStatus,
  PrintJobType,
  TableStatus,
  StoreBotStatus,
} from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { purgeOldOrders } from "./jobs/purgeOldOrders";
import { recoverStuckOrders } from "./jobs/recoverStuckOrders";
import { calculatePricing } from "./pricingRule";
import {
  authenticateAgent,
  getBearerToken,
  generateAgentToken,
  maskToken,
  requireAdmin,
} from "./auth";
import {
  buildBillingPdf,
  buildOrderPdf,
  buildPublicOrderReceiptPdf,
  buildPublicOrderReceiptPng,
  buildRevenuePdf,
  buildTableSummaryPdf,
} from "./pdf";
import type { JwtUser } from "./types/jwt";
import { getOrderCode } from "./utils/orderCode";
import {
  disconnect,
  ensureInstance,
  getInstanceStatus,
  getQr,
  registerIncomingWebhook,
  isEvolutionApiError,
} from "./evolution";



type RevenueRange = "today" | "7d" | "15d" | "30d" | "custom";

type RevenuePeriod = {
  rangeLabel: string;
  startDate: Date;
  endDateExclusive: Date;
};

const revenueRangeQuerySchema = z
  .object({
    range: z.enum(["today", "7d", "15d", "30d", "custom"]).default("today"),
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((value, context) => {
    if (value.range !== "custom") {
      return;
    }
    if (!value.start) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start"],
        message: "Data inicial é obrigatória para período personalizado.",
      });
    }
    if (!value.end) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "Data final é obrigatória para período personalizado.",
      });
    }
  });

const formatDateOnly = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(date);

const formatDateInputLocal = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseLocalDateInput = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const resolveRevenuePeriod = (params: {
  range: RevenueRange;
  start?: string;
  end?: string;
}): RevenuePeriod => {
  const todayStart = startOfDay(new Date());

  if (params.range === "today") {
    return {
      rangeLabel: "Hoje",
      startDate: todayStart,
      endDateExclusive: addDays(todayStart, 1),
    };
  }

  if (params.range === "7d" || params.range === "15d" || params.range === "30d") {
    const days = Number(params.range.replace("d", ""));
    const periodStart = addDays(todayStart, -(days - 1));
    return {
      rangeLabel: `Últimos ${days} dias`,
      startDate: periodStart,
      endDateExclusive: addDays(todayStart, 1),
    };
  }

  const startDate = parseLocalDateInput(params.start ?? "");
  const endDate = parseLocalDateInput(params.end ?? "");
  if (!startDate || !endDate) {
    throw new Error("Período inválido.");
  }
  const customStart = startOfDay(startDate);
  const customEndExclusive = addDays(startOfDay(endDate), 1);
  if (customStart >= customEndExclusive) {
    throw new Error("Período inválido.");
  }

  return {
    rangeLabel: "Personalizado",
    startDate: customStart,
    endDateExclusive: customEndExclusive,
  };
};

const buildRevenuePeriodLabel = (period: RevenuePeriod) => {
  const inclusiveEnd = addDays(period.endDateExclusive, -1);
  return `${formatDateOnly(period.startDate)} - ${formatDateOnly(inclusiveEnd)}`;
};


const buildRevenueTimeseriesPoints = async (storeId: string, period: RevenuePeriod) => {
  const rows = await prisma.order.groupBy({
    by: ["createdAt"],
    where: {
      storeId,
      status: OrderStatus.PRINTED,
      createdAt: {
        gte: period.startDate,
        lt: period.endDateExclusive,
      },
    },
    _sum: {
      total: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const revenueByDay = new Map<string, number>();
  for (const row of rows) {
    const key = formatDateInputLocal(row.createdAt);
    const revenueCents = row._sum.total
      ? Math.round(row._sum.total.toNumber() * 100)
      : 0;
    revenueByDay.set(key, (revenueByDay.get(key) ?? 0) + revenueCents);
  }

  const points: Array<{ date: string; label: string; revenueCents: number }> = [];
  for (
    let day = startOfDay(period.startDate);
    day < period.endDateExclusive;
    day = addDays(day, 1)
  ) {
    const date = formatDateInputLocal(day);
    points.push({
      date,
      label: formatDateOnly(day),
      revenueCents: revenueByDay.get(date) ?? 0,
    });
  }

  return points;
};

const slugRegex = /^[a-z0-9-]+$/;

const normalizeSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const parsePublicBaseUrl = (request: FastifyRequest) => {
  const explicit = process.env.PUBLIC_API_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const protocol =
    (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
    request.protocol;
  const host =
    (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0] ||
    request.headers.host;
  return `${protocol}://${host}`;
};

const buildMenuUrl = (request: FastifyRequest, slug: string) =>
  `${parsePublicBaseUrl(request)}/api/public/${slug}/menu`;

const buildReceiptUrl = (request: FastifyRequest, orderId: string, receiptToken: string | null) => {
  if (!receiptToken) {
    return null;
  }
  const query = new URLSearchParams({ token: receiptToken });
  return `${parsePublicBaseUrl(request)}/api/public/orders/${orderId}/receipt.png?${query.toString()}`;
};

const ensureStoreBotConfig = async (storeId: string, storeSlug: string) =>
  prisma.storeBotConfig.upsert({
    where: { storeId },
    update: {
      instanceName: storeSlug,
    },
    create: {
      storeId,
      instanceName: storeSlug,
    },
  });

const app = Fastify({
  logger: true,
});

const agentAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  const agent = await authenticateAgent(request);
  if (!agent) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  (request as typeof request & { agent: typeof agent }).agent = agent;
  request.storeId = agent.storeId;
};

app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (_request, body, done) => {
    if (!body) {
      done(null, undefined);
      return;
    }
    try {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error);
    }
  }
);

const storeCookieName = "sp_store_token";
const storeCookieMaxAge = 60 * 60 * 24 * 30;
const cookieDomain = process.env.COOKIE_DOMAIN;
const storeCookieSameSite = (() => {
  const normalized = process.env.COOKIE_SAMESITE?.toLowerCase();
  if (normalized === "none" || normalized === "lax" || normalized === "strict") {
    return normalized;
  }
  return process.env.NODE_ENV === "production" ? "none" : "lax";
})();
const storeCookieSecure =
  process.env.NODE_ENV === "production" || storeCookieSameSite === "none";

const orderStreamClients = new Map<string, Set<FastifyReply>>();
const orderStreamPingers = new Map<FastifyReply, NodeJS.Timeout>();
const menuStreamClients = new Map<string, Set<FastifyReply>>();
const salonStreamClients = new Map<string, Set<FastifyReply>>();
const salonStreamPingers = new Map<FastifyReply, NodeJS.Timeout>();
const waiterLoginAttempts = new Map<
  string,
  { count: number; resetAt: number }
>();

const parseOrigins = (value?: string) =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const buildAllowedOrigins = () => {
  const corsOrigins = parseOrigins(process.env.CORS_ORIGIN);
  const baseOrigins =
    corsOrigins.length > 0
      ? corsOrigins
      : [
          "https://painel.smartpedidos.com.br",
          "https://p.smartpedidos.com.br",
          ...parseOrigins(process.env.STORE_PANEL_ORIGINS),
          ...parseOrigins(process.env.PUBLIC_PANEL_ORIGINS),
        ];
  const origins = new Set<string>(baseOrigins);

  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://localhost:3000");
  }

  return origins;
};

const buildStoreCookieOptions = () => ({
  httpOnly: true,
  secure: storeCookieSecure,
  sameSite: storeCookieSameSite as "lax" | "none" | "strict",
  path: "/",
  maxAge: storeCookieMaxAge,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
});

const buildStoreLogoutCookieOptions = () => ({
  httpOnly: true,
  secure: storeCookieSecure,
  sameSite: storeCookieSameSite as "lax" | "none" | "strict",
  path: "/",
  maxAge: 0,
  ...(cookieDomain ? { domain: cookieDomain } : {}),
});

const getMaintenanceToken = (request: FastifyRequest) => {
  const header = request.headers["x-maintenance-token"];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
};

const sendOrderStreamEvent = (
  storeId: string,
  event: string,
  payload: Record<string, unknown>
) => {
  const storeStreams = orderStreamClients.get(storeId);
  if (!storeStreams) {
    return;
  }
  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  storeStreams.forEach((client) => {
    try {
      client.raw.write(message);
    } catch {
      const ping = orderStreamPingers.get(client);
      if (ping) {
        clearInterval(ping);
        orderStreamPingers.delete(client);
      }
      storeStreams.delete(client);
    }
  });
  if (storeStreams.size === 0) {
    orderStreamClients.delete(storeId);
  }
};

const subscribeMenuStream = (slug: string, reply: FastifyReply) => {
  const clients = menuStreamClients.get(slug) ?? new Set();
  clients.add(reply);
  menuStreamClients.set(slug, clients);
};

const unsubscribeMenuStream = (slug: string, reply: FastifyReply) => {
  const clients = menuStreamClients.get(slug);
  if (!clients) {
    return;
  }
  clients.delete(reply);
  if (clients.size === 0) {
    menuStreamClients.delete(slug);
  }
};

const emitMenuStreamEvent = (slug: string, reason: MenuUpdateReason) => {
  const clients = menuStreamClients.get(slug);
  if (!clients) {
    return;
  }
  const payload = {
    reason,
  };
  const message = `event: menu_updated\ndata: ${JSON.stringify(payload)}\n\n`;
  Array.from(clients).forEach((client) => {
    if (client.raw.writableEnded) {
      clients.delete(client);
      return;
    }
    try {
      client.raw.write(message);
    } catch {
      clients.delete(client);
    }
  });
  if (clients.size === 0) {
    menuStreamClients.delete(slug);
  }
};

const sendSalonStreamEvent = (
  storeId: string,
  payload: { reason: "open" | "close" | "order_created" | "settings" }
) => {
  const storeStreams = salonStreamClients.get(storeId);
  if (!storeStreams) {
    return;
  }
  const message = `event: tables_updated\ndata: ${JSON.stringify(payload)}\n\n`;
  storeStreams.forEach((client) => {
    try {
      client.raw.write(message);
    } catch {
      const ping = salonStreamPingers.get(client);
      if (ping) {
        clearInterval(ping);
        salonStreamPingers.delete(client);
      }
      storeStreams.delete(client);
    }
  });
  if (storeStreams.size === 0) {
    salonStreamClients.delete(storeId);
  }
};

const normalizeOptionGroupRules = ({
  type,
  required,
  minSelect,
  maxSelect,
}: {
  type: "SINGLE" | "MULTI";
  required: boolean;
  minSelect: number;
  maxSelect: number;
}) => {
  let normalizedMin = minSelect;
  let normalizedMax = maxSelect;

  if (type === "SINGLE") {
    normalizedMin = required ? 1 : 0;
    normalizedMax = 1;
  } else {
    if (required && normalizedMin === 0) {
      normalizedMin = 1;
    }
    if (normalizedMax > 0 && normalizedMax < normalizedMin) {
      return {
        ok: false,
        message: "O máximo deve ser maior ou igual ao mínimo.",
      };
    }
  }

  return {
    ok: true as const,
    minSelect: normalizedMin,
    maxSelect: normalizedMax,
  };
};

const syncSalonTables = async (
  tx: Prisma.TransactionClient,
  storeId: string,
  desiredCount: number
) => {
  const normalizedCount = Math.max(0, desiredCount);
  const existingTables = await tx.salonTable.findMany({
    where: { storeId },
    select: { number: true, status: true },
  });
  const existingNumbers = new Set(existingTables.map((table) => table.number));
  const missingNumbers = Array.from({ length: normalizedCount }, (_, index) => {
    const number = index + 1;
    return existingNumbers.has(number) ? null : number;
  }).filter((number): number is number => number !== null);

  if (missingNumbers.length > 0) {
    await tx.salonTable.createMany({
      data: missingNumbers.map((number) => ({
        storeId,
        number,
      })),
    });
  }

  const removableTables = existingTables.filter(
    (table) => table.number > normalizedCount
  );
  if (removableTables.length > 0) {
    const hasOpenTable = removableTables.some(
      (table) => table.status === TableStatus.OPEN
    );
    if (hasOpenTable) {
      throw new Error(
        "Não é possível reduzir a quantidade de mesas enquanto houver mesas abertas."
      );
    }
    await tx.salonTable.deleteMany({
      where: {
        storeId,
        number: {
          gt: normalizedCount,
        },
      },
    });
  }
};

type AvailabilityWindowInput = {
  startMinute: number;
  endMinute: number;
  active?: boolean;
};

const normalizeAvailabilityWindows = (windows: AvailabilityWindowInput[]) => {
  const normalized = windows.map((window) => ({
    startMinute: Math.floor(window.startMinute),
    endMinute: Math.floor(window.endMinute),
    active: window.active ?? true,
  }));

  for (const window of normalized) {
    if (
      !Number.isFinite(window.startMinute) ||
      !Number.isFinite(window.endMinute)
    ) {
      return {
        ok: false as const,
        message: "Informe horários válidos para a disponibilidade.",
      };
    }
    if (
      window.startMinute < 0 ||
      window.startMinute >= 1440 ||
      window.endMinute <= 0 ||
      window.endMinute > 1440
    ) {
      return {
        ok: false as const,
        message: "Os horários devem estar entre 00:00 e 23:59.",
      };
    }
    if (window.startMinute >= window.endMinute) {
      return {
        ok: false as const,
        message: "O horário inicial deve ser menor que o horário final.",
      };
    }
  }

  return { ok: true as const, windows: normalized };
};

type StoreHoursData = {
  timezone: string;
  monOpen: string | null;
  monClose: string | null;
  monEnabled: boolean;
  tueOpen: string | null;
  tueClose: string | null;
  tueEnabled: boolean;
  wedOpen: string | null;
  wedClose: string | null;
  wedEnabled: boolean;
  thuOpen: string | null;
  thuClose: string | null;
  thuEnabled: boolean;
  friOpen: string | null;
  friClose: string | null;
  friEnabled: boolean;
  satOpen: string | null;
  satClose: string | null;
  satEnabled: boolean;
  sunOpen: string | null;
  sunClose: string | null;
  sunEnabled: boolean;
  isOpenNowOverride: OpenOverride;
  closedMessage: string | null;
};

const defaultHours: StoreHoursData = {
  timezone: "America/Sao_Paulo",
  monOpen: null,
  monClose: null,
  monEnabled: false,
  tueOpen: null,
  tueClose: null,
  tueEnabled: false,
  wedOpen: null,
  wedClose: null,
  wedEnabled: false,
  thuOpen: null,
  thuClose: null,
  thuEnabled: false,
  friOpen: null,
  friClose: null,
  friEnabled: false,
  satOpen: null,
  satClose: null,
  satEnabled: false,
  sunOpen: null,
  sunClose: null,
  sunEnabled: false,
  isOpenNowOverride: OpenOverride.AUTO,
  closedMessage: null,
};

const parseTimeToMinutes = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const getLocalTimeParts = (timezone: string) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return {
    weekday,
    minutes:
      hour && minute ? Number(hour) * 60 + Number(minute) : Number.NaN,
  };
};

const getLocalWeekdayIndex = (timezone: string) => {
  const { weekday } = getLocalTimeParts(timezone);
  if (!weekday) {
    return null;
  }
  const dayIndexMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return dayIndexMap[weekday] ?? null;
};

const getNextAvailabilityChangeMinutes = ({
  availableDays,
  windows,
  currentWeekdayIndex,
  currentMinutes,
}: {
  availableDays: number[];
  windows: { startMinute: number; endMinute: number }[];
  currentWeekdayIndex: number | null;
  currentMinutes: number;
}) => {
  if (!currentWeekdayIndex || Number.isNaN(currentMinutes)) {
    return null;
  }

  const isDayAvailable = (dayIndex: number) =>
    availableDays.length === 0 || availableDays.includes(dayIndex);

  if (availableDays.length === 0 && windows.length === 0) {
    return null;
  }

  let nextMinutes = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset <= 7; offset += 1) {
    const dayIndex = ((currentWeekdayIndex - 1 + offset) % 7) + 1;
    if (!isDayAvailable(dayIndex)) {
      continue;
    }

    const dayOffsetMinutes = offset * 1440;
    const candidates =
      windows.length === 0
        ? [0, 1440]
        : windows.flatMap((window) => [window.startMinute, window.endMinute]);

    for (const minute of candidates) {
      const diff = dayOffsetMinutes + minute - currentMinutes;
      if (diff > 0 && diff < nextMinutes) {
        nextMinutes = diff;
      }
    }
  }

  if (!Number.isFinite(nextMinutes)) {
    return null;
  }

  return nextMinutes;
};

const calculateIsOpenNow = (hours: StoreHoursData) => {
  if (hours.isOpenNowOverride === OpenOverride.FORCE_OPEN) {
    return true;
  }
  if (hours.isOpenNowOverride === OpenOverride.FORCE_CLOSED) {
    return false;
  }

  const { weekday, minutes } = getLocalTimeParts(hours.timezone);
  if (!weekday || Number.isNaN(minutes)) {
    return true;
  }

  const dayMap: Record<string, string> = {
    Mon: "mon",
    Tue: "tue",
    Wed: "wed",
    Thu: "thu",
    Fri: "fri",
    Sat: "sat",
    Sun: "sun",
  };
  const dayKey = dayMap[weekday];
  if (!dayKey) {
    return true;
  }

  const enabled = hours[`${dayKey}Enabled` as keyof typeof hours];
  const openValue = hours[`${dayKey}Open` as keyof typeof hours];
  const closeValue = hours[`${dayKey}Close` as keyof typeof hours];

  if (!enabled || typeof openValue !== "string" || typeof closeValue !== "string") {
    return false;
  }

  const openMinutes = parseTimeToMinutes(openValue);
  const closeMinutes = parseTimeToMinutes(closeValue);
  if (openMinutes === null || closeMinutes === null) {
    return false;
  }

  if (closeMinutes < openMinutes) {
    return minutes >= openMinutes || minutes < closeMinutes;
  }

  return minutes >= openMinutes && minutes <= closeMinutes;
};

const getStoreIdFromToken = (token: string) => {
  try {
    const payload = app.jwt.verify<JwtUser>(token);
    if (payload.role !== "STORE" || !payload.storeId) {
      return null;
    }
    return payload.storeId;
  } catch {
    return null;
  }
};

const getSalonAccessStoreIdFromToken = (token: string) => {
  try {
    const payload = app.jwt.verify<JwtUser>(token);
    if (!payload.storeId) {
      return null;
    }
    if (payload.role === "STORE" || payload.role === "WAITER") {
      return payload.storeId;
    }
    return null;
  } catch {
    return null;
  }
};

const getSalonTokenFromRequest = (request: FastifyRequest) => {
  let token: string | null = getBearerToken(request);
  if (!token && request.cookies) {
    const cookieToken = request.cookies[storeCookieName];
    if (typeof cookieToken === "string" && cookieToken.trim()) {
      token = cookieToken.trim();
    }
  }
  if (!token) {
    const query = request.query as { token?: string } | undefined;
    if (query?.token && typeof query.token === "string" && query.token.trim()) {
      token = query.token.trim();
    }
  }
  return token;
};

type TableSummaryItem = {
  name: string;
  quantity: number;
  totalCents: number;
};

const printJobStatusValues = new Set<string>([
  ...Object.values(PrintJobStatus),
  "PRINTING",
  "CANCELED",
  "CANCELLED",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const formatCurrencyCents = (amountCents: number) => {
  const normalized = (amountCents / 100).toFixed(2).replace(".", ",");
  return `R$ ${normalized}`;
};

const formatLine = (label: string, value: string, width = 42) => {
  if (label.length + value.length + 1 <= width) {
    return `${label}${" ".repeat(width - label.length - value.length)}${value}`;
  }
  return `${label} ${value}`;
};

const formatItemLines = (item: TableSummaryItem, width = 42) => {
  const label = `${item.quantity}x ${item.name}`;
  const total = formatCurrencyCents(item.totalCents);
  if (label.length + total.length + 1 <= width) {
    return [formatLine(label, total, width)];
  }
  return [label, `${" ".repeat(Math.max(width - total.length, 0))}${total}`];
};

const buildTableSessionSummary = async (
  client: Prisma.TransactionClient | PrismaClient,
  {
    storeId,
    tableId,
    tableSessionId,
  }: { storeId: string; tableId: string; tableSessionId: string | null }
) => {
  if (!tableSessionId) {
    return { items: [] as TableSummaryItem[], totalCents: 0 };
  }

  const orders = await client.order.findMany({
    where: {
      storeId,
      orderType: OrderType.DINE_IN,
      tableId,
      tableSessionId,
    },
    include: {
      items: {
        include: { product: true },
      },
    },
  });

  const itemsByProduct = new Map<string, TableSummaryItem>();
  let totalCents = 0;

  orders.forEach((order) => {
    order.items.forEach((item) => {
      const lineTotal = item.unitPriceCents * item.quantity;
      totalCents += lineTotal;
      const existing = itemsByProduct.get(item.productId);
      if (existing) {
        existing.quantity += item.quantity;
        existing.totalCents += lineTotal;
      } else {
        itemsByProduct.set(item.productId, {
          name: item.product.name,
          quantity: item.quantity,
          totalCents: lineTotal,
        });
      }
    });
  });

  const items = Array.from(itemsByProduct.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return { items, totalCents };
};

type PrintJobPayloadInput = {
  payload: unknown;
  type: PrintJobType;
  tableId: string | null;
  tableSessionId: string | null;
  createdAt: Date;
  storeId: string;
};

const serializePayloadDates = (value: unknown): unknown => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializePayloadDates);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        serializePayloadDates(item),
      ])
    );
  }
  return value;
};

const buildAgentPrintJobPayload = async (
  client: Prisma.TransactionClient | PrismaClient,
  printJob: PrintJobPayloadInput
) => {
  const basePayload = isRecord(printJob.payload) ? { ...printJob.payload } : {};

  if (printJob.type !== PrintJobType.CASHIER_TABLE_SUMMARY) {
    return serializePayloadDates(basePayload) as Record<string, unknown>;
  }

  if (!printJob.tableId) {
    return serializePayloadDates(basePayload) as Record<string, unknown>;
  }

  const table = await client.salonTable.findFirst({
    where: { id: printJob.tableId, storeId: printJob.storeId },
    select: { number: true },
  });

  const summary = await buildTableSessionSummary(client, {
    storeId: printJob.storeId,
    tableId: printJob.tableId,
    tableSessionId: printJob.tableSessionId,
  });

  const payload = {
    ...basePayload,
    tableId: printJob.tableId,
    tableNumber: table?.number,
    sessionId: printJob.tableSessionId,
    closedAt: printJob.createdAt.toISOString(),
    items: summary.items,
    totalCents: summary.totalCents,
  };

  return serializePayloadDates(payload) as Record<string, unknown>;
};

const requireStoreAuth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  let token: string | null = getBearerToken(request);
  if (!token && request.cookies) {
    const cookieToken = request.cookies[storeCookieName];
    if (typeof cookieToken === "string" && cookieToken.trim()) {
      token = cookieToken.trim();
    }
  }

  if (!token) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const storeId = getStoreIdFromToken(token);
  if (!storeId) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  request.storeId = storeId;
};

const requireSalonAuth = async (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const token = getSalonTokenFromRequest(request);
  if (!token) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  const storeId = getSalonAccessStoreIdFromToken(token);
  if (!storeId) {
    return reply.status(401).send({ message: "Unauthorized" });
  }

  request.storeId = storeId;
};

type MenuUpdateReason = "promo" | "product_update" | "schedule";

const emitMenuUpdateByStoreId = async (
  storeId: string,
  reason: MenuUpdateReason = "product_update"
) => {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { slug: true },
  });
  if (store?.slug) {
    emitMenuStreamEvent(store.slug, reason);
  }
};

const registerRoutes = () => {
  app.decorateRequest("storeId", null);

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/internal/maintenance/purge-old-orders", async (request, reply) => {
    const maintenanceToken = process.env.MAINTENANCE_TOKEN;
    if (!maintenanceToken) {
      app.log.error("MAINTENANCE_TOKEN is not set");
      return reply
        .status(500)
        .send({ message: "Maintenance token not configured" });
    }

    const providedToken = getMaintenanceToken(request);
    if (!providedToken || providedToken !== maintenanceToken) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const result = await purgeOldOrders(prisma, { logger: app.log });
    return reply.send({ ok: true, ...result });
  });

  app.get("/public/:slug/menu", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const { slug } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { slug },
      include: {
        categories: {
          where: { active: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            products: {
              where: { active: true },
              include: {
                availabilityWindows: {
                  where: { active: true },
                  orderBy: { startMinute: "asc" },
                },
                optionGroups: {
                  include: {
                    items: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                    },
                  },
                  orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                },
              },
            },
          },
        },
        deliveryAreas: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
        hours: true,
        paymentSettings: true,
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const storeTimezone =
      store.timezone ?? store.hours?.timezone ?? defaultHours.timezone;
    const currentWeekdayIndex = getLocalWeekdayIndex(storeTimezone);
    const { minutes: currentMinutes } = getLocalTimeParts(storeTimezone);
    const isProductAvailableToday = (availableDays: number[]) => {
      if (availableDays.length === 0) {
        return true;
      }
      if (!currentWeekdayIndex) {
        return true;
      }
      return availableDays.includes(currentWeekdayIndex);
    };
    const isProductAvailableNow = (
      windows: { startMinute: number; endMinute: number }[]
    ) => {
      if (windows.length === 0) {
        return true;
      }
      if (Number.isNaN(currentMinutes)) {
        return true;
      }
      return windows.some(
        (window) =>
          window.startMinute <= currentMinutes &&
          currentMinutes < window.endMinute
      );
    };
    let nextRefreshInMinutes: number | null = null;
    store.categories.forEach((category) => {
      category.products.forEach((product) => {
        const nextChangeMinutes = getNextAvailabilityChangeMinutes({
          availableDays: product.availableDays,
          windows: product.availabilityWindows,
          currentWeekdayIndex,
          currentMinutes,
        });
        if (
          nextChangeMinutes !== null &&
          (nextRefreshInMinutes === null ||
            nextChangeMinutes < nextRefreshInMinutes)
        ) {
          nextRefreshInMinutes = nextChangeMinutes;
        }
      });
    });
    const nextRefreshAt =
      nextRefreshInMinutes === null
        ? null
        : new Date(
            Date.now() + nextRefreshInMinutes * 60 * 1000
          ).toISOString();

    const hours = store.hours
      ? {
          timezone: store.hours.timezone,
          monOpen: store.hours.monOpen,
          monClose: store.hours.monClose,
          monEnabled: store.hours.monEnabled,
          tueOpen: store.hours.tueOpen,
          tueClose: store.hours.tueClose,
          tueEnabled: store.hours.tueEnabled,
          wedOpen: store.hours.wedOpen,
          wedClose: store.hours.wedClose,
          wedEnabled: store.hours.wedEnabled,
          thuOpen: store.hours.thuOpen,
          thuClose: store.hours.thuClose,
          thuEnabled: store.hours.thuEnabled,
          friOpen: store.hours.friOpen,
          friClose: store.hours.friClose,
          friEnabled: store.hours.friEnabled,
          satOpen: store.hours.satOpen,
          satClose: store.hours.satClose,
          satEnabled: store.hours.satEnabled,
          sunOpen: store.hours.sunOpen,
          sunClose: store.hours.sunClose,
          sunEnabled: store.hours.sunEnabled,
          isOpenNowOverride: store.hours.isOpenNowOverride,
          closedMessage: store.hours.closedMessage,
        }
      : defaultHours;

    const paymentSettings = store.paymentSettings ?? {
      acceptPix: true,
      acceptCash: true,
      acceptCard: true,
      requireChangeForCash: false,
      pixKey: null,
      pixName: null,
      pixBank: null,
    };

    return {
      store: {
        name: store.name,
        slug: store.slug,
        isOpenNow: store.hours ? calculateIsOpenNow(hours) : true,
        closedMessage: hours.closedMessage,
        allowPickup: store.allowPickup,
        allowDelivery: store.allowDelivery,
        logoUrl: store.logoUrl,
        bannerUrl: store.bannerUrl,
        billingModel: store.billingModel,
        perOrderFeeCents: store.perOrderFeeCents,
        showFeeOnPublicMenu: store.showFeeOnPublicMenu,
        feeLabel: store.feeLabel,
      },
      categories: store.categories.map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products
          .filter(
            (product) =>
              isProductAvailableToday(product.availableDays) &&
              isProductAvailableNow(product.availabilityWindows)
          )
          .map((product) => ({
            id: product.id,
            name: product.name,
            priceCents: Math.round(product.price.toNumber() * 100),
            active: product.active,
            isPromo: product.isPromo,
            pricingRule: product.pricingRule,
            optionGroups: product.optionGroups.map((group) => ({
              id: group.id,
              name: group.name,
              type: group.type,
              required: group.required,
              minSelect: group.minSelect,
              maxSelect: group.maxSelect,
              sortOrder: group.sortOrder,
              items: group.items.map((item) => ({
                id: item.id,
                name: item.name,
                priceDeltaCents: item.priceDeltaCents,
                isActive: item.isActive,
                sortOrder: item.sortOrder,
              })),
            })),
          })),
      })),
      deliveryAreas: store.deliveryAreas.map((area) => ({
        id: area.id,
        name: area.name,
        feeCents: area.feeCents,
      })),
      hours,
      payment: paymentSettings,
      nextRefreshAt,
    };
  });

  app.get("/public/:slug/menu/stream", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const { slug } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { slug },
      select: { id: true, isActive: true },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Keep-Alive", "timeout=120");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    reply.raw.write("retry: 10000\n");
    reply.raw.write(":ok\n\n");
    reply.raw.setTimeout(0);

    subscribeMenuStream(slug, reply);

    request.raw.on("close", () => {
      unsubscribeMenuStream(slug, reply);
    });

    return reply.raw;
  });

  app.post("/public/:slug/waiter/login", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const bodySchema = z.object({
      pin: z
        .string()
        .refine(
          (value) => /^\d{4}$|^\d{6}$/.test(value),
          "PIN deve ter 4 ou 6 dígitos."
        ),
    });

    const { slug } = paramsSchema.parse(request.params);
    const { pin } = bodySchema.parse(request.body ?? {});

    const store = await prisma.store.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        isActive: true,
        salonEnabled: true,
        waiterPinHash: true,
        waiterPwaEnabled: true,
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    if (!store.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    if (!store.waiterPwaEnabled) {
      return reply.status(403).send({
        message: "Acesso do garçom está desativado.",
      });
    }

    if (!store.waiterPinHash) {
      return reply.status(400).send({
        message: "PIN do garçom não configurado.",
      });
    }

    const now = Date.now();
    const key = `${slug}:${request.ip}`;
    const windowMs = 5 * 60 * 1000;
    const maxAttempts = 10;
    const existing = waiterLoginAttempts.get(key);
    if (existing && existing.resetAt > now && existing.count >= maxAttempts) {
      return reply.status(429).send({
        message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
      });
    }
    const attemptEntry =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;

    const ok = await bcrypt.compare(pin, store.waiterPinHash);
    if (!ok) {
      attemptEntry.count += 1;
      waiterLoginAttempts.set(key, attemptEntry);
      return reply.status(401).send({ message: "PIN inválido." });
    }

    waiterLoginAttempts.delete(key);

    const waiterToken = await reply.jwtSign(
      {
        id: store.id,
        role: "WAITER",
        storeId: store.id,
        slug: store.slug,
      },
      { expiresIn: "12h", sub: store.id }
    );

    return reply.send({ waiterToken });
  });

  app.post("/public/:slug/orders", async (request, reply) => {
    const paramsSchema = z.object({ slug: z.string() });
    const addressSchema = z.object({
      line: z.string().min(1),
      number: z.string().min(1),
      neighborhood: z.string().min(1),
      city: z.string().min(1),
      reference: z.string().min(1).optional(),
    });
    const bodySchema = z.object({
      customerName: z.string().min(1).optional(),
      customerPhone: z.string().min(1).optional(),
      orderType: z.enum(["PICKUP", "DELIVERY", "DINE_IN"]).optional(),
      fulfillmentType: z.enum(["PICKUP", "DELIVERY", "DINE_IN"]).optional(),
      notes: z.string().min(1).optional(),
      address: addressSchema.optional(),
      deliveryAreaId: z.string().uuid().optional(),
      addressLine: z.string().min(1).optional(),
      addressNumber: z.string().min(1).optional(),
      addressNeighborhood: z.string().min(1).optional(),
      addressCity: z.string().min(1).optional(),
      addressRef: z.string().min(1).optional(),
      tableId: z.string().uuid().optional(),
      paymentMethod: z.enum(["PIX", "CASH", "CARD"]).optional(),
      changeForCents: z.number().int().nonnegative().optional(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
            notes: z.string().min(1).optional(),
            options: z
              .array(
                z.object({
                  groupId: z.string().uuid(),
                  itemIds: z.array(z.string().uuid()).min(1),
                })
              )
              .optional(),
          })
        )
        .min(1),
    });

    const { slug } = paramsSchema.parse(request.params);
    const {
      items,
      fulfillmentType,
      orderType,
      address,
      customerName,
      customerPhone,
      notes,
      deliveryAreaId,
      addressLine,
      addressNumber,
      addressNeighborhood,
      addressCity,
      addressRef,
      tableId,
      paymentMethod,
      changeForCents,
    } = bodySchema.parse(request.body);

    const normalizedOrderType = orderType ?? fulfillmentType ?? "PICKUP";
    const isDelivery = normalizedOrderType === "DELIVERY";
    const isDineIn = normalizedOrderType === "DINE_IN";

    const store = await prisma.store.findUnique({
      where: { slug },
      include: {
        hours: true,
        paymentSettings: true,
      },
    });

    if (!store || !store.isActive) {
      return reply.status(404).send({ message: "Store not found" });
    }

    if (isDineIn && !store.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    if (normalizedOrderType === "DELIVERY" && !store.allowDelivery) {
      return reply.status(400).send({
        message: "Entrega indisponível para esta loja.",
      });
    }

    if (normalizedOrderType === "PICKUP" && !store.allowPickup) {
      return reply.status(400).send({
        message: "Retirada indisponível para esta loja.",
      });
    }

    const hours = store.hours
      ? {
          timezone: store.hours.timezone,
          monOpen: store.hours.monOpen,
          monClose: store.hours.monClose,
          monEnabled: store.hours.monEnabled,
          tueOpen: store.hours.tueOpen,
          tueClose: store.hours.tueClose,
          tueEnabled: store.hours.tueEnabled,
          wedOpen: store.hours.wedOpen,
          wedClose: store.hours.wedClose,
          wedEnabled: store.hours.wedEnabled,
          thuOpen: store.hours.thuOpen,
          thuClose: store.hours.thuClose,
          thuEnabled: store.hours.thuEnabled,
          friOpen: store.hours.friOpen,
          friClose: store.hours.friClose,
          friEnabled: store.hours.friEnabled,
          satOpen: store.hours.satOpen,
          satClose: store.hours.satClose,
          satEnabled: store.hours.satEnabled,
          sunOpen: store.hours.sunOpen,
          sunClose: store.hours.sunClose,
          sunEnabled: store.hours.sunEnabled,
          isOpenNowOverride: store.hours.isOpenNowOverride,
          closedMessage: store.hours.closedMessage,
        }
      : defaultHours;

    const isOpenNow = store.hours ? calculateIsOpenNow(hours) : true;

    if (!isOpenNow) {
      return reply.status(400).send({
        message: hours.closedMessage || "A loja está fechada no momento.",
      });
    }

    if (!isDineIn && (!customerName || !customerPhone)) {
      return reply.status(400).send({
        message: "Informe nome e telefone do cliente.",
      });
    }

    let tableSessionId: string | null = null;
    if (isDineIn) {
      if (!tableId) {
        return reply.status(400).send({
          message: "Mesa obrigatória para pedidos no salão.",
        });
      }
      const selectedTable = await prisma.salonTable.findFirst({
        where: { id: tableId, storeId: store.id },
      });
      if (!selectedTable) {
        return reply.status(404).send({ message: "Mesa não encontrada." });
      }
      if (selectedTable.status !== TableStatus.OPEN) {
        return reply.status(400).send({
          message: "A mesa deve estar aberta para lançar pedidos.",
        });
      }
      if (!selectedTable.currentSessionId) {
        return reply.status(400).send({
          message: "A mesa precisa ter uma sessão ativa para receber pedidos.",
        });
      }
      tableSessionId = selectedTable.currentSessionId;
    }

    if (!isDineIn && !paymentMethod) {
      return reply
        .status(400)
        .send({ message: "Forma de pagamento obrigatória." });
    }

    const paymentSettings = store.paymentSettings ?? {
      acceptPix: true,
      acceptCash: true,
      acceptCard: true,
      requireChangeForCash: false,
    };

    if (!isDineIn && paymentMethod) {
      const paymentAllowed =
        (paymentMethod === "PIX" && paymentSettings.acceptPix) ||
        (paymentMethod === "CASH" && paymentSettings.acceptCash) ||
        (paymentMethod === "CARD" && paymentSettings.acceptCard);

      if (!paymentAllowed) {
        return reply
          .status(400)
          .send({ message: "Forma de pagamento indisponível." });
      }
    }

    const normalizedAddressLine = addressLine ?? address?.line ?? null;
    const normalizedAddressNumber = addressNumber ?? address?.number ?? null;
    const normalizedAddressNeighborhood =
      addressNeighborhood ?? address?.neighborhood ?? null;
    const normalizedAddressCity = addressCity ?? address?.city ?? null;
    const normalizedAddressRef = addressRef ?? address?.reference ?? null;

    if (isDelivery && !deliveryAreaId) {
      return reply
        .status(400)
        .send({ message: "Selecione um bairro para entrega." });
    }

    if (isDelivery && !normalizedAddressLine) {
      return reply.status(400).send({ message: "Endereço é obrigatório." });
    }

    const productIds = items.map((item) => item.productId);
    const uniqueProductIds = [...new Set(productIds)];
    const products = await prisma.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        category: {
          storeId: store.id,
        },
        active: true,
      },
      include: {
        optionGroups: {
          include: {
            items: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    const productMap = new Map(products.map((product) => [product.id, product]));
    const normalizedItems: Array<{
      productId: string;
      quantity: number;
      notes?: string;
      unitPriceCents: number;
      optionEntries: Array<{
        groupName: string;
        itemName: string;
        priceDeltaCents: number;
      }>;
    }> = [];
    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return reply.status(400).send({
          message: `Product ${item.productId} not found or inactive for this store.`,
        });
      }
      const unitPriceCents = Math.round(product.price.toNumber() * 100);
      const pricingRule = product.pricingRule ?? "SUM";
      const selectionInputs = item.options ?? [];
      const groupIds = new Set(product.optionGroups.map((group) => group.id));
      const invalidGroup = selectionInputs.find(
        (selection) => !groupIds.has(selection.groupId)
      );
      if (invalidGroup) {
        return reply.status(400).send({
          message: `Option group ${invalidGroup.groupId} does not belong to product ${product.name}.`,
        });
      }

      const optionEntries: Array<{
        groupName: string;
        itemName: string;
        priceDeltaCents: number;
      }> = [];
      const selectedGroups: Array<{
        groupName: string;
        items: Array<{ priceDeltaCents: number }>;
      }> = [];

      for (const group of product.optionGroups) {
        const selectedIds =
          selectionInputs.find((selection) => selection.groupId === group.id)
            ?.itemIds ?? [];
        const uniqueSelectedIds = [...new Set(selectedIds)];
        const activeItems = group.items.filter((option) => option.isActive);
        const activeMap = new Map(activeItems.map((option) => [option.id, option]));
        const selectedItems = uniqueSelectedIds.map((optionId) =>
          activeMap.get(optionId)
        );

        if (selectedItems.some((option) => !option)) {
          const invalidOptionId = uniqueSelectedIds.find(
            (optionId) => !activeMap.has(optionId)
          );
          return reply.status(400).send({
            message: `Option ${invalidOptionId ?? "unknown"} does not belong to product ${product.name}.`,
          });
        }

        const minRequired = group.required
          ? Math.max(group.minSelect, 1)
          : group.minSelect;
        const maxAllowed =
          group.type === "SINGLE"
            ? 1
            : group.maxSelect > 0
              ? group.maxSelect
              : Number.POSITIVE_INFINITY;

        if (
          selectedItems.length < minRequired ||
          selectedItems.length > maxAllowed
        ) {
          return reply.status(400).send({
            message: `Product ${product.name} has invalid options for group ${group.name}.`,
          });
        }

        selectedGroups.push({
          groupName: group.name,
          items: selectedItems.map((option) => ({
            priceDeltaCents: option!.priceDeltaCents,
          })),
        });

        selectedItems.forEach((option) => {
          optionEntries.push({
            groupName: group.name,
            itemName: option!.name,
            priceDeltaCents: option!.priceDeltaCents,
          });
        });
      }

      const pricingResult = calculatePricing({
        pricingRule,
        basePriceCents: unitPriceCents,
        groups: selectedGroups,
      });

      if (pricingRule === "MAX_OPTION" && !pricingResult.hasFlavorSelection) {
        return reply.status(400).send({ message: "Selecione ao menos 1 sabor." });
      }
      if (pricingRule === "HALF_SUM") {
        if (pricingResult.flavorsCount === 0) {
          return reply
            .status(400)
            .send({ message: "Selecione ao menos 1 sabor." });
        }
        if (pricingResult.flavorsCount > 2) {
          return reply
            .status(400)
            .send({ message: "Selecione no máximo 2 sabores." });
        }
      }

      normalizedItems.push({
        ...item,
        unitPriceCents: pricingResult.unitPriceCents,
        optionEntries,
      });
    }

    const subtotalCents = normalizedItems.reduce(
      (acc, item) => acc + item.unitPriceCents * item.quantity,
      0
    );
    let deliveryFeeCents = 0;
    let deliveryNeighborhood = normalizedAddressNeighborhood;

    if (isDelivery) {
      const area = await prisma.deliveryArea.findFirst({
        where: {
          id: deliveryAreaId,
          storeId: store.id,
          isActive: true,
        },
      });
      if (!area) {
        return reply
          .status(400)
          .send({ message: "Bairro de entrega inválido." });
      }
      deliveryFeeCents = area.feeCents;
      deliveryNeighborhood = area.name;
    }

    const shouldApplyConvenienceFee =
      store.billingModel === "PER_ORDER" &&
      store.showFeeOnPublicMenu &&
      store.perOrderFeeCents > 0;
    const convenienceFeeCents = shouldApplyConvenienceFee
      ? store.perOrderFeeCents
      : 0;
    const convenienceFeeLabel = shouldApplyConvenienceFee
      ? store.feeLabel
      : null;

    const totalCents = subtotalCents + deliveryFeeCents + convenienceFeeCents;
    const total = totalCents / 100;

    if (!isDineIn && paymentMethod === "CASH") {
      if (paymentSettings.requireChangeForCash && changeForCents === undefined) {
        return reply.status(400).send({
          message: "Informe o troco para pagamento em dinheiro.",
        });
      }
      if (changeForCents !== undefined && changeForCents < totalCents) {
        return reply.status(400).send({
          message: "Troco deve ser maior ou igual ao total do pedido.",
        });
      }
    }

    const initialStatus = store.autoPrintEnabled ? "PRINTING" : "NEW";
    const initialPrintingClaimedAt =
      initialStatus === "PRINTING" ? new Date() : null;
    const effectivePaymentMethod = isDineIn
      ? paymentMethod ?? "CASH"
      : paymentMethod!;
    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          storeId: store.id,
          status: initialStatus,
          fulfillmentType: normalizedOrderType,
          orderType: normalizedOrderType,
          customerName: customerName ?? null,
          customerPhone: customerPhone ?? null,
          notes: notes ?? null,
          addressLine: isDelivery ? normalizedAddressLine : null,
          addressNumber: isDelivery ? normalizedAddressNumber : null,
          addressNeighborhood: isDelivery ? deliveryNeighborhood : null,
          addressCity: isDelivery ? normalizedAddressCity : null,
          addressReference:
            isDelivery ? normalizedAddressRef : null,
          deliveryAreaId: isDelivery ? deliveryAreaId ?? null : null,
          tableId: isDineIn ? tableId ?? null : null,
          tableSessionId: isDineIn ? tableSessionId : null,
          deliveryFeeCents,
          convenienceFeeCents,
          convenienceFeeLabel,
          paymentMethod: effectivePaymentMethod,
          changeForCents:
            !isDineIn && paymentMethod === "CASH"
              ? changeForCents ?? null
              : null,
          receiptToken: randomBytes(16).toString("hex"),
          total,
          printingClaimedAt: initialPrintingClaimedAt,
        },
      });

      for (const item of normalizedItems) {
        const createdItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes ?? null,
          },
        });

        if (item.optionEntries.length > 0) {
          await tx.orderItemOption.createMany({
            data: item.optionEntries.map((option) => ({
              orderItemId: createdItem.id,
              groupName: option.groupName,
              itemName: option.itemName,
              priceDeltaCents: option.priceDeltaCents,
            })),
          });
        }
      }

      return createdOrder;
    });

    sendOrderStreamEvent(store.id, "order.created", {
      orderId: order.id,
      storeId: store.id,
      status: order.status,
    });
    if (isDineIn) {
      sendSalonStreamEvent(store.id, { reason: "order_created" });
    }

    const shortCode = getOrderCode(order.id);

    const webhookUrl = process.env.ACTIVEPIECES_ORDER_CREATED_WEBHOOK_URL?.trim();
    if (webhookUrl && !isDineIn) {
      try {
        const botConfig = await ensureStoreBotConfig(store.id, store.slug);
        if (botConfig.enabled && botConfig.sendOrderConfirmation) {
          const receiptUrl = buildReceiptUrl(request, order.id, order.receiptToken);
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              storeSlug: store.slug,
              orderId: order.id,
              orderCode: shortCode,
              customerName: order.customerName,
              customerPhone: order.customerPhone,
              paymentMethod: order.paymentMethod,
              totalCents,
              receiptUrl: botConfig.sendReceiptLink ? receiptUrl : null,
            }),
          });
        }
      } catch (error) {
        request.log.error(error);
      }
    }

    return reply.status(201).send({
      id: order.id,
      shortCode,
      receiptToken: order.receiptToken,
      status: order.status,
      paymentMethod: order.paymentMethod,
      // Compatibilidade retroativa para frontends ainda não migrados.
      orderId: order.id,
      number: shortCode,
    });
  });

  app.get("/public/orders/:id/receipt.pdf", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const querySchema = z.object({ token: z.string().min(1).max(64) });

    const { id } = paramsSchema.parse(request.params);
    const { token } = querySchema.parse(request.query);

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        store: {
          select: { name: true },
        },
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Comprovante não encontrado." });
    }

    if (!order.receiptToken || order.receiptToken !== token) {
      return reply.status(403).send({ message: "Token de comprovante inválido." });
    }

    const shortId = getOrderCode(order.id);
    const pdf = buildPublicOrderReceiptPdf(order);

    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `attachment; filename="comprovante-${shortId}.pdf"`
    );

    return reply.send(pdf);
  });


  app.get("/public/orders/:id/receipt.png", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const querySchema = z.object({ token: z.string().min(1).max(64) });

    const { id } = paramsSchema.parse(request.params);
    const { token } = querySchema.parse(request.query);

    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        store: {
          select: { name: true },
        },
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Comprovante não encontrado." });
    }

    if (!order.receiptToken || order.receiptToken !== token) {
      return reply.status(403).send({ message: "Token de comprovante inválido." });
    }

    const shortId = getOrderCode(order.id);
    const png = await buildPublicOrderReceiptPng(order);

    reply.header("Content-Type", "image/png");
    reply.header(
      "Content-Disposition",
      `attachment; filename="comprovante-${shortId}.png"`
    );

    return reply.send(png);
  });

  app.post("/auth/store/login", async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const { email, password } = bodySchema.parse(request.body);

    const store = await prisma.store.findUnique({
      where: { email },
    });

    if (!store || !store.isActive || !store.passwordHash) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const passwordMatches = await bcrypt.compare(password, store.passwordHash);
    if (!passwordMatches) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = app.jwt.sign(
      { id: store.id, role: "STORE", storeId: store.id },
      { sub: store.id }
    );

    reply.setCookie(storeCookieName, token, buildStoreCookieOptions());

    return reply.send({
      token,
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
      },
    });
  });

  app.post("/auth/store/logout", async (_request, reply) => {
    reply.clearCookie(storeCookieName, buildStoreLogoutCookieOptions());
    return reply.status(204).send();
  });

  app.post("/auth/admin/bootstrap", async (request, reply) => {
    const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const headerToken = request.headers["x-bootstrap-token"];

    if (!bootstrapToken) {
      return reply.status(403).send({ message: "Bootstrap disabled" });
    }

    if (headerToken !== bootstrapToken) {
      return reply.status(401).send({ message: "Invalid bootstrap token" });
    }

    const adminExists = await prisma.admin.count();
    if (adminExists > 0) {
      return reply.status(409).send({ message: "Admin already exists" });
    }

    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
    });

    const { name, email, password } = schema.parse(request.body);

    const passwordHash = await bcrypt.hash(password, 10);

    const admin = await prisma.admin.create({
      data: { name, email, passwordHash },
      select: { id: true, name: true, email: true },
    });

    const token = await reply.jwtSign(
      { id: admin.id, role: "ADMIN" },
      { expiresIn: "7d", sub: admin.id }
    );

    return reply.send({ admin, token });
  });

  app.post("/auth/admin/login", async (request, reply) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(1),
    });

    const { email, password } = schema.parse(request.body);

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin || !admin.active) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) {
      return reply.status(401).send({ message: "Invalid credentials" });
    }

    const token = await reply.jwtSign(
      { id: admin.id, role: "ADMIN" },
      { expiresIn: "7d", sub: admin.id }
    );

    return reply.send({
      admin: { id: admin.id, name: admin.name, email: admin.email },
      token,
    });
  });

  app.log.info("Admin auth routes registered");

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/admin")) {
      return;
    }

    return requireAdmin(request, reply);
  });

  const buildAdminStoreStats = async (storeId: string, days: number) => {
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - days);
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const [ordersInPeriod, ordersToday, lastOrder] = await Promise.all([
      prisma.order.count({
        where: {
          storeId,
          createdAt: {
            gte: periodStart,
          },
        },
      }),
      prisma.order.count({
        where: {
          storeId,
          createdAt: {
            gte: startOfToday,
          },
        },
      }),
      prisma.order.findFirst({
        where: {
          storeId,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
        },
      }),
    ]);

    return {
      storeId,
      ordersInPeriod,
      ordersToday,
      lastOrderAt: lastOrder?.createdAt ?? null,
    };
  };

  app.get("/admin/stores", async (_request, reply) => {
    const stores = await prisma.store.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        billingModel: true,
        monthlyPriceCents: true,
        perOrderFeeCents: true,
        showFeeOnPublicMenu: true,
        feeLabel: true,
        createdAt: true,
      },
    });

    return reply.send(
      stores.map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        billingModel: store.billingModel,
        monthlyPriceCents: store.monthlyPriceCents,
        perOrderFeeCents: store.perOrderFeeCents,
        showFeeOnPublicMenu: store.showFeeOnPublicMenu,
        feeLabel: store.feeLabel,
        createdAt: store.createdAt,
      }))
    );
  });

  app.get("/admin/stores/:id/stats", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const querySchema = z.object({
      days: z.coerce.number().int().positive().max(365).optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { days } = querySchema.parse(request.query ?? {});
    const periodDays = days ?? 7;

    const stats = await buildAdminStoreStats(id, periodDays);
    return reply.send(stats);
  });

  app.get("/admin/stores/:id/stats/week", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const stats = await buildAdminStoreStats(id, 7);

    return reply.send({
      storeId: id,
      ordersLast7Days: stats.ordersInPeriod,
      ordersToday: stats.ordersToday,
      lastOrderAt: stats.lastOrderAt,
    });
  });

  app.get("/admin/stores/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        billingModel: true,
        monthlyPriceCents: true,
        perOrderFeeCents: true,
        showFeeOnPublicMenu: true,
        feeLabel: true,
        createdAt: true,
      },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return reply.send({
      id: store.id,
      name: store.name,
      slug: store.slug,
      email: store.email,
      isActive: store.isActive,
      billingModel: store.billingModel,
      monthlyPriceCents: store.monthlyPriceCents,
      perOrderFeeCents: store.perOrderFeeCents,
      showFeeOnPublicMenu: store.showFeeOnPublicMenu,
      feeLabel: store.feeLabel,
      createdAt: store.createdAt,
    });
  });

  app.get("/admin/stores/:id/billing.pdf", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const querySchema = z.object({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    });

    const { id } = paramsSchema.parse(request.params);
    const { from, to } = querySchema.parse(request.query ?? {});

    const parseDate = (value: string, endOfDay = false) => {
      const date = new Date(
        `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
      );
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const fromDate = parseDate(from);
    const toDate = parseDate(to, true);

    if (!fromDate || !toDate || fromDate > toDate) {
      return reply.status(400).send({ message: "Período inválido." });
    }

    const store = await prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        billingModel: true,
        perOrderFeeCents: true,
        feeLabel: true,
      },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    if (store.billingModel !== "PER_ORDER") {
      return reply.status(400).send({ message: "Loja no plano mensal." });
    }

    const ordersCount = await prisma.order.count({
      where: {
        storeId: id,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    const totalCents = ordersCount * (store.perOrderFeeCents ?? 0);
    const pdf = buildBillingPdf({
      store,
      from: fromDate,
      to: toDate,
      ordersCount,
      totalCents,
      generatedAt: new Date(),
    });

    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=billing-${id}-${from}-${to}.pdf`
    );
    return reply.send(pdf);
  });

  app.post("/admin/stores", async (request, reply) => {
    const bodySchema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      email: z.string().email(),
      password: z.string().min(6),
      isActive: z.boolean().optional(),
      billingModel: z.enum(["MONTHLY", "PER_ORDER"]).optional(),
      monthlyPriceCents: z.number().int().nonnegative().nullable().optional(),
      perOrderFeeCents: z.number().int().nonnegative().optional(),
      showFeeOnPublicMenu: z.boolean().optional(),
      feeLabel: z.string().min(1).optional(),
    });

    const {
      name,
      slug,
      email,
      password,
      isActive,
      billingModel,
      monthlyPriceCents,
      perOrderFeeCents,
      showFeeOnPublicMenu,
      feeLabel,
    } = bodySchema.parse(
      request.body
    );
    const normalizedSlug = normalizeSlug(slug);
    if (!slugRegex.test(normalizedSlug)) {
      return reply.status(400).send({ message: "Invalid slug" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const resolvedBillingModel = billingModel ?? "MONTHLY";

    if (resolvedBillingModel === "PER_ORDER" && !feeLabel?.trim()) {
      return reply
        .status(400)
        .send({ message: "Informe o texto da taxa." });
    }

    try {
      const store = await prisma.store.create({
        data: {
          name,
          slug: normalizedSlug,
          email,
          passwordHash,
          isActive: isActive ?? true,
          billingModel: resolvedBillingModel,
          monthlyPriceCents:
            resolvedBillingModel === "MONTHLY" ? monthlyPriceCents ?? null : null,
          perOrderFeeCents:
            resolvedBillingModel === "PER_ORDER"
              ? perOrderFeeCents ?? 0
              : 0,
          showFeeOnPublicMenu:
            resolvedBillingModel === "PER_ORDER"
              ? showFeeOnPublicMenu ?? false
              : false,
          feeLabel:
            resolvedBillingModel === "PER_ORDER"
              ? feeLabel?.trim()
              : "Taxa de conveniência do app",
        },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          isActive: true,
          billingModel: true,
          monthlyPriceCents: true,
          perOrderFeeCents: true,
          showFeeOnPublicMenu: true,
          feeLabel: true,
          createdAt: true,
        },
      });

      return reply.status(201).send({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        billingModel: store.billingModel,
        monthlyPriceCents: store.monthlyPriceCents,
        perOrderFeeCents: store.perOrderFeeCents,
        showFeeOnPublicMenu: store.showFeeOnPublicMenu,
        feeLabel: store.feeLabel,
        createdAt: store.createdAt,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.status(409).send({ message: "Store already exists" });
      }
      throw error;
    }
  });

  app.patch("/admin/stores/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      slug: z.string().min(1).optional(),
      email: z.string().email().optional(),
      isActive: z.boolean().optional(),
      billingModel: z.enum(["MONTHLY", "PER_ORDER"]).optional(),
      monthlyPriceCents: z.number().int().nonnegative().nullable().optional(),
      perOrderFeeCents: z.number().int().nonnegative().optional(),
      showFeeOnPublicMenu: z.boolean().optional(),
      feeLabel: z.string().min(1).optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const {
      name,
      slug,
      email,
      isActive,
      billingModel,
      monthlyPriceCents,
      perOrderFeeCents,
      showFeeOnPublicMenu,
      feeLabel,
    } = bodySchema.parse(request.body);

    if (
      !name &&
      !slug &&
      !email &&
      isActive === undefined &&
      !billingModel &&
      monthlyPriceCents === undefined &&
      perOrderFeeCents === undefined &&
      showFeeOnPublicMenu === undefined &&
      !feeLabel
    ) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const normalizedSlug = slug ? normalizeSlug(slug) : undefined;
    if (normalizedSlug && !slugRegex.test(normalizedSlug)) {
      return reply.status(400).send({ message: "Invalid slug" });
    }

    try {
      const currentStore = await prisma.store.findUnique({
        where: { id },
        select: {
          billingModel: true,
          monthlyPriceCents: true,
          perOrderFeeCents: true,
          showFeeOnPublicMenu: true,
          feeLabel: true,
        },
      });

      if (!currentStore) {
        return reply.status(404).send({ message: "Store not found" });
      }

      const nextBillingModel = billingModel ?? currentStore.billingModel;
      const nextMonthlyPriceCents =
        monthlyPriceCents ?? currentStore.monthlyPriceCents;
      const nextPerOrderFeeCents =
        perOrderFeeCents ?? currentStore.perOrderFeeCents;
      const nextShowFeeOnPublicMenu =
        showFeeOnPublicMenu ?? currentStore.showFeeOnPublicMenu;
      const nextFeeLabel = feeLabel?.trim() ?? currentStore.feeLabel;

      if (nextBillingModel === "PER_ORDER" && !nextFeeLabel?.trim()) {
        return reply
          .status(400)
          .send({ message: "Informe o texto da taxa." });
      }

      const resolvedPerOrderFeeCents =
        nextBillingModel === "PER_ORDER" ? nextPerOrderFeeCents : 0;
      const resolvedShowFeeOnPublicMenu =
        nextBillingModel === "PER_ORDER" ? nextShowFeeOnPublicMenu : false;
      const resolvedMonthlyPriceCents =
        nextBillingModel === "MONTHLY" ? nextMonthlyPriceCents : null;

      const store = await prisma.store.update({
        where: { id },
        data: {
          name,
          slug: normalizedSlug,
          email,
          isActive,
          billingModel: nextBillingModel,
          monthlyPriceCents: resolvedMonthlyPriceCents,
          perOrderFeeCents: resolvedPerOrderFeeCents,
          showFeeOnPublicMenu: resolvedShowFeeOnPublicMenu,
          feeLabel:
            nextBillingModel === "PER_ORDER"
              ? nextFeeLabel
              : "Taxa de conveniência do app",
        },
        select: {
          id: true,
          name: true,
          slug: true,
          email: true,
          isActive: true,
          billingModel: true,
          monthlyPriceCents: true,
          perOrderFeeCents: true,
          showFeeOnPublicMenu: true,
          feeLabel: true,
          createdAt: true,
        },
      });

      return reply.send({
        id: store.id,
        name: store.name,
        slug: store.slug,
        email: store.email,
        isActive: store.isActive,
        billingModel: store.billingModel,
        monthlyPriceCents: store.monthlyPriceCents,
        perOrderFeeCents: store.perOrderFeeCents,
        showFeeOnPublicMenu: store.showFeeOnPublicMenu,
        feeLabel: store.feeLabel,
        createdAt: store.createdAt,
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return reply.status(409).send({ message: "Store already exists" });
      }
      throw error;
    }
  });

  app.post("/admin/stores/:id/reset-password", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      password: z.string().min(6),
    });

    const { id } = paramsSchema.parse(request.params);
    const { password } = bodySchema.parse(request.body);

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.store.update({
      where: { id },
      data: { passwordHash },
    });

    return reply.send({ ok: true });
  });

  app.post("/admin/stores/:id/toggle", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });

    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({ where: { id } });
    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const updated = await prisma.store.update({
      where: { id },
      data: { isActive: !store.isActive },
      select: {
        id: true,
        name: true,
        slug: true,
        email: true,
        isActive: true,
        createdAt: true,
      },
    });

    return reply.send({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      email: updated.email,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
    });
  });

  app.delete("/admin/stores/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });

    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { id },
      select: { id: true, isActive: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    if (store.isActive) {
      return reply
        .status(400)
        .send({ message: "Desative a loja antes de excluir." });
    }

    await prisma.$transaction([
      prisma.orderItemOption.deleteMany({
        where: { orderItem: { order: { storeId: id } } },
      }),
      prisma.orderItem.deleteMany({
        where: { order: { storeId: id } },
      }),
      prisma.order.deleteMany({
        where: { storeId: id },
      }),
      prisma.productOptionItem.deleteMany({
        where: { group: { product: { category: { storeId: id } } } },
      }),
      prisma.productOptionGroup.deleteMany({
        where: { product: { category: { storeId: id } } },
      }),
      prisma.product.deleteMany({
        where: { category: { storeId: id } },
      }),
      prisma.category.deleteMany({
        where: { storeId: id },
      }),
      prisma.agent.deleteMany({
        where: { storeId: id },
      }),
      prisma.deliveryArea.deleteMany({
        where: { storeId: id },
      }),
      prisma.storeHours.deleteMany({
        where: { storeId: id },
      }),
      prisma.storePaymentSettings.deleteMany({
        where: { storeId: id },
      }),
      prisma.store.delete({
        where: { id },
      }),
    ]);

    return reply.status(204).send();
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/agent")) {
      return;
    }

    const agent = await authenticateAgent(request);
    if (!agent) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    (request as typeof request & { agent: typeof agent }).agent = agent;
    request.storeId = agent.storeId;
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/store")) {
      return;
    }
    if (request.url.startsWith("/store/salon")) {
      return requireSalonAuth(request, reply);
    }
    if (
      request.url.startsWith("/store/print-jobs") &&
      request.method === "GET"
    ) {
      const token = getBearerToken(request);
      if (token) {
        try {
          const payload = app.jwt.verify<JwtUser>(token);
          if (payload.role === "ADMIN") {
            request.adminId = payload.id ?? null;
            return;
          }
        } catch {
          // Ignore and fall back to store auth.
        }
      }
    }

    return requireStoreAuth(request, reply);
  });

  const assertPublicBotSecret = (request: FastifyRequest, reply: FastifyReply) => {
    const secret = process.env.ACTIVEPIECES_PUBLIC_BOT_SECRET?.trim();
    if (!secret) {
      return true;
    }
    const incoming = request.headers["x-bot-secret"];
    if (incoming !== secret) {
      reply.status(401).send({ message: "Unauthorized" });
      return false;
    }
    return true;
  };

  const serializePublicBotConfig = ({
    store,
    config,
    request,
  }: {
    store: { id: string; slug: string; name: string; isActive: boolean };
    config: {
      enabled: boolean;
      instanceName: string;
      status: StoreBotStatus;
      keywords: string;
      sendMenuOnKeywords: boolean;
      sendOrderConfirmation: boolean;
      sendReceiptLink: boolean;
      pixMessageEnabled: boolean;
      menuTemplate: string;
      orderTemplate: string;
      pixTemplate: string;
      cooldownMinutes: number;
      connectedPhone: string | null;
      webhookStatus: string | null;
      webhookUrl: string | null;
      webhookEnabled: boolean | null;
      webhookEvents: string[];
      webhookAppliedAt: Date | null;
      lastWebhookError: string | null;
      updatedAt: Date;
    };
    request: FastifyRequest;
  }) => ({
    enabled: config.enabled,
    instanceName: config.instanceName,
    status: config.status,
    keywords: config.keywords,
    sendMenuOnKeywords: config.sendMenuOnKeywords,
    sendOrderConfirmation: config.sendOrderConfirmation,
    sendReceiptLink: config.sendReceiptLink,
    pixMessageEnabled: config.pixMessageEnabled,
    menuTemplate: config.menuTemplate,
    orderTemplate: config.orderTemplate,
    pixTemplate: config.pixTemplate,
    cooldownMinutes: config.cooldownMinutes,
    menuUrl: buildMenuUrl(request, store.slug),
    store: {
      id: store.id,
      name: store.name,
      slug: store.slug,
      connectedPhone: config.connectedPhone,
      webhookStatus: config.webhookStatus,
      webhookUrl: config.webhookUrl,
      webhookEnabled: config.webhookEnabled,
      webhookEvents: config.webhookEvents,
      webhookAppliedAt: config.webhookAppliedAt,
      lastWebhookError: config.lastWebhookError,
      isActive: store.isActive,
      updatedAt: config.updatedAt,
    },
  });

  app.get("/store/me", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      include: { paymentSettings: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return {
      id: store.id,
      name: store.name,
      slug: store.slug,
      email: store.email,
      isActive: store.isActive,
      autoPrintEnabled: store.autoPrintEnabled,
      allowPickup: store.allowPickup,
      allowDelivery: store.allowDelivery,
      logoUrl: store.logoUrl,
      bannerUrl: store.bannerUrl,
      requireChangeForCash:
        store.paymentSettings?.requireChangeForCash ?? false,
    };
  });

  app.get("/store/bot", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);
    return reply.send(config);
  });

  app.put("/store/bot", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const schema = z.object({
      enabled: z.boolean().optional(),
      keywords: z.string().min(1).max(1000).optional(),
      sendMenuOnKeywords: z.boolean().optional(),
      sendOrderConfirmation: z.boolean().optional(),
      sendReceiptLink: z.boolean().optional(),
      pixMessageEnabled: z.boolean().optional(),
      menuTemplate: z.string().min(1).max(4000).optional(),
      orderTemplate: z.string().min(1).max(4000).optional(),
      pixTemplate: z.string().min(1).max(4000).optional(),
      cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    });

    const payload = schema.parse(request.body ?? {});
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    await ensureStoreBotConfig(store.id, store.slug);

    const updated = await prisma.storeBotConfig.update({
      where: { storeId: store.id },
      data: {
        instanceName: store.slug,
        ...payload,
      },
    });

    return reply.send(updated);
  });

  app.post("/store/bot/whatsapp/qr", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);

    try {
      await ensureInstance(config.instanceName);
      const result = await getQr(config.instanceName);
      const status =
        result.status === StoreBotStatus.DISCONNECTED
          ? StoreBotStatus.WAITING_QR
          : result.status;

      const webhookTargetUrl = process.env.ACTIVEPIECES_INCOMING_WEBHOOK_URL?.trim() ?? null;
      let webhookPatch: {
        webhookStatus?: string | null;
        webhookUrl?: string | null;
        webhookEnabled?: boolean | null;
        webhookEvents?: string[];
        webhookAppliedAt?: Date | null;
        lastWebhookError?: string | null;
      } = {};

      if (status === StoreBotStatus.CONNECTED && webhookTargetUrl) {
        const shouldApplyWebhook =
          !config.webhookAppliedAt ||
          config.webhookUrl !== webhookTargetUrl ||
          !config.webhookEnabled ||
          config.webhookEvents.length !== 1 ||
          config.webhookEvents[0] !== "MESSAGES_UPSERT";

        if (shouldApplyWebhook) {
          try {
            const webhookResult = await registerIncomingWebhook(config.instanceName);
            webhookPatch = {
              webhookStatus: "REGISTERED",
              webhookUrl: webhookResult.webhookUrl,
              webhookEnabled: webhookResult.webhookEnabled,
              webhookEvents: webhookResult.webhookEvents,
              webhookAppliedAt: new Date(),
              lastWebhookError: null,
            };
            request.log.info(
              {
                tag: "evolution webhook",
                statusCode: webhookResult.statusCode,
                instanceName: config.instanceName,
                instanceId: webhookResult.instanceId,
              },
              "Webhook da Evolution configurado com sucesso."
            );
          } catch (error) {
            webhookPatch = {
              webhookStatus: "ERROR",
              webhookUrl: webhookTargetUrl,
              webhookEnabled: false,
              webhookEvents: ["MESSAGES_UPSERT"],
              lastWebhookError: isEvolutionApiError(error)
                ? `${error.statusCode} ${error.responseBody}`
                : error instanceof Error
                  ? error.message
                  : "Erro desconhecido ao configurar webhook.",
            };
            request.log.error(
              {
                tag: "evolution webhook",
                statusCode: isEvolutionApiError(error) ? error.statusCode : null,
                body: isEvolutionApiError(error) ? error.responseBody : null,
                instanceName: config.instanceName,
              },
              "Falha ao configurar webhook da instância na Evolution."
            );
          }
        }
      }

      const updated = await prisma.storeBotConfig.update({
        where: { storeId: store.id },
        data: {
          status,
          connectedPhone:
            status === StoreBotStatus.CONNECTED ? result.connectedPhone : null,
          instanceName: store.slug,
          ...webhookPatch,
        },
      });

      return reply.send({
        ...updated,
        qrBase64: result.qrBase64,
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(502).send({ message: "Falha ao gerar QR na Evolution." });
    }
  });

  app.post("/store/bot/whatsapp/refresh-status", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);

    try {
      const instance = await getInstanceStatus(config.instanceName);
      const webhookTargetUrl = process.env.ACTIVEPIECES_INCOMING_WEBHOOK_URL?.trim() ?? null;
      let webhookPatch: {
        webhookStatus?: string | null;
        webhookUrl?: string | null;
        webhookEnabled?: boolean | null;
        webhookEvents?: string[];
        webhookAppliedAt?: Date | null;
        lastWebhookError?: string | null;
      } = {};

      if (instance.status === StoreBotStatus.CONNECTED && webhookTargetUrl) {
        const shouldApplyWebhook =
          !config.webhookAppliedAt ||
          config.webhookUrl !== webhookTargetUrl ||
          !config.webhookEnabled ||
          config.webhookEvents.length !== 1 ||
          config.webhookEvents[0] !== "MESSAGES_UPSERT";

        if (shouldApplyWebhook) {
          try {
            const webhookResult = await registerIncomingWebhook(config.instanceName);
            webhookPatch = {
              webhookStatus: "REGISTERED",
              webhookUrl: webhookResult.webhookUrl,
              webhookEnabled: webhookResult.webhookEnabled,
              webhookEvents: webhookResult.webhookEvents,
              webhookAppliedAt: new Date(),
              lastWebhookError: null,
            };
            request.log.info(
              {
                tag: "evolution webhook",
                statusCode: webhookResult.statusCode,
                instanceName: config.instanceName,
                instanceId: webhookResult.instanceId,
              },
              "Webhook da Evolution configurado com sucesso."
            );
          } catch (error) {
            webhookPatch = {
              webhookStatus: "ERROR",
              webhookUrl: webhookTargetUrl,
              webhookEnabled: false,
              webhookEvents: ["MESSAGES_UPSERT"],
              lastWebhookError: isEvolutionApiError(error)
                ? `${error.statusCode} ${error.responseBody}`
                : error instanceof Error
                  ? error.message
                  : "Erro desconhecido ao configurar webhook.",
            };
            request.log.error(
              {
                tag: "evolution webhook",
                statusCode: isEvolutionApiError(error) ? error.statusCode : null,
                body: isEvolutionApiError(error) ? error.responseBody : null,
                instanceName: config.instanceName,
              },
              "Falha ao configurar webhook da instância na Evolution."
            );
          }
        }
      }

      const updated = await prisma.storeBotConfig.update({
        where: { storeId: store.id },
        data: {
          status: instance.status,
          connectedPhone:
            instance.status === StoreBotStatus.CONNECTED ? instance.connectedPhone : null,
          instanceName: store.slug,
          ...webhookPatch,
        },
      });

      return reply.send(updated);
    } catch (error) {
      request.log.error(error);
      return reply.status(502).send({ message: "Falha ao consultar status na Evolution." });
    }
  });

  app.post("/store/bot/whatsapp/disconnect", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);

    try {
      await disconnect(config.instanceName);
    } catch (error) {
      request.log.error(error);
    }

    const updated = await prisma.storeBotConfig.update({
      where: { storeId: store.id },
      data: {
        status: StoreBotStatus.DISCONNECTED,
        connectedPhone: null,
        instanceName: store.slug,
        webhookStatus: null,
        webhookUrl: null,
        webhookEnabled: null,
        webhookEvents: [],
        webhookAppliedAt: null,
        lastWebhookError: null,
      },
    });

    return reply.send(updated);
  });

  app.get("/public/bot/by-instance/:instanceName", async (request, reply) => {
    if (!assertPublicBotSecret(request, reply)) {
      return;
    }
    const paramsSchema = z.object({ instanceName: z.string().min(1) });
    const { instanceName } = paramsSchema.parse(request.params);

    const store = await prisma.store.findFirst({
      where: { slug: instanceName },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);
    return reply.send(serializePublicBotConfig({ store, config, request }));
  });

  app.get("/public/bot/by-store-slug/:slug", async (request, reply) => {
    if (!assertPublicBotSecret(request, reply)) {
      return;
    }
    const paramsSchema = z.object({ slug: z.string().min(1) });
    const { slug } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const config = await ensureStoreBotConfig(store.id, store.slug);
    return reply.send(serializePublicBotConfig({ store, config, request }));
  });

  app.get("/store/dashboard/summary", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const todayStart = startOfDay(new Date());
    const tomorrowStart = addDays(todayStart, 1);

    const [newOrders, ordersToday, revenueToday] = await Promise.all([
      prisma.order.count({
        where: {
          storeId,
          status: OrderStatus.NEW,
        },
      }),
      prisma.order.count({
        where: {
          storeId,
          createdAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
      }),
      prisma.order.aggregate({
        where: {
          storeId,
          status: OrderStatus.PRINTED,
          createdAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
        _sum: {
          total: true,
        },
      }),
    ]);

    return reply.send({
      newOrders,
      ordersToday,
      revenueTodayCents: revenueToday._sum?.total
        ? Math.round(revenueToday._sum.total.toNumber() * 100)
        : 0,
    });
  });

  app.get("/store/revenue/summary", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const queryResult = revenueRangeQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ message: "Período inválido." });
    }

    let period: RevenuePeriod;
    try {
      period = resolveRevenuePeriod(queryResult.data);
    } catch {
      return reply.status(400).send({ message: "Período inválido." });
    }

    const aggregate = await prisma.order.aggregate({
      where: {
        storeId,
        status: OrderStatus.PRINTED,
        createdAt: {
          gte: period.startDate,
          lt: period.endDateExclusive,
        },
      },
      _sum: {
        total: true,
      },
      _count: {
        _all: true,
      },
    });

    const revenueCents = aggregate._sum?.total
      ? Math.round(aggregate._sum.total.toNumber() * 100)
      : 0;
    const ordersCount = aggregate._count?._all ?? 0;

    return reply.send({
      rangeLabel: period.rangeLabel,
      ordersCount,
      revenueCents,
      averageTicketCents:
        ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0,
    });
  });



  app.get("/store/revenue/timeseries", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const queryResult = revenueRangeQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ message: "Período inválido." });
    }

    let period: RevenuePeriod;
    try {
      period = resolveRevenuePeriod(queryResult.data);
    } catch {
      return reply.status(400).send({ message: "Período inválido." });
    }

    const points = await buildRevenueTimeseriesPoints(storeId, period);

    return reply.send({
      rangeLabel: period.rangeLabel,
      points,
    });
  });

  app.get("/store/revenue/report.pdf", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const queryResult = revenueRangeQuerySchema.safeParse(request.query ?? {});
    if (!queryResult.success) {
      return reply.status(400).send({ message: "Período inválido." });
    }

    let period: RevenuePeriod;
    try {
      period = resolveRevenuePeriod(queryResult.data);
    } catch {
      return reply.status(400).send({ message: "Período inválido." });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true, slug: true },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const aggregate = await prisma.order.aggregate({
      where: {
        storeId,
        status: OrderStatus.PRINTED,
        createdAt: {
          gte: period.startDate,
          lt: period.endDateExclusive,
        },
      },
      _sum: {
        total: true,
      },
      _count: {
        _all: true,
      },
    });

    const revenueCents = aggregate._sum?.total
      ? Math.round(aggregate._sum.total.toNumber() * 100)
      : 0;
    const ordersCount = aggregate._count?._all ?? 0;
    const averageTicketCents =
      ordersCount > 0 ? Math.round(revenueCents / ordersCount) : 0;

    const pdf = buildRevenuePdf({
      store,
      rangeLabel: period.rangeLabel,
      periodLabel: buildRevenuePeriodLabel(period),
      ordersCount,
      revenueCents,
      averageTicketCents,
      generatedAt: new Date(),
    });

    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=revenue-${store.slug}-${period.startDate
        .toISOString()
        .slice(0, 10)}-${addDays(period.endDateExclusive, -1)
        .toISOString()
        .slice(0, 10)}.pdf`
    );
    return reply.send(pdf);
  });

  app.patch("/store/me", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      autoPrintEnabled: z.boolean().optional(),
    });

    const payload = bodySchema.parse(request.body ?? {});

    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        autoPrintEnabled: payload.autoPrintEnabled ?? undefined,
      },
    });

    return reply.send({
      id: store.id,
      name: store.name,
      slug: store.slug,
      email: store.email,
      isActive: store.isActive,
      autoPrintEnabled: store.autoPrintEnabled,
      allowPickup: store.allowPickup,
      allowDelivery: store.allowDelivery,
      logoUrl: store.logoUrl,
      bannerUrl: store.bannerUrl,
    });
  });

  app.patch("/store/settings", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      allowPickup: z.boolean().optional(),
      allowDelivery: z.boolean().optional(),
      logoUrl: z.string().max(500).optional().nullable(),
      bannerUrl: z.string().max(500).optional().nullable(),
    });

    const payload = bodySchema.parse(request.body ?? {});

    const current = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        allowPickup: true,
        allowDelivery: true,
      },
    });

    if (!current) {
      return reply.status(404).send({ message: "Store not found" });
    }

    const nextAllowPickup = payload.allowPickup ?? current.allowPickup;
    const nextAllowDelivery = payload.allowDelivery ?? current.allowDelivery;

    if (!nextAllowPickup && !nextAllowDelivery) {
      return reply.status(400).send({
        message: "Selecione pelo menos uma forma de atendimento.",
      });
    }

    const normalizeOptionalString = (value?: string | null) => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    };

    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        allowPickup: payload.allowPickup ?? undefined,
        allowDelivery: payload.allowDelivery ?? undefined,
        logoUrl: normalizeOptionalString(payload.logoUrl),
        bannerUrl: normalizeOptionalString(payload.bannerUrl),
      },
    });

    return reply.send({
      allowPickup: store.allowPickup,
      allowDelivery: store.allowDelivery,
      logoUrl: store.logoUrl,
      bannerUrl: store.bannerUrl,
    });
  });

  app.post("/store/agents", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
    });

    const { name } = bodySchema.parse(request.body);
    const token = generateAgentToken();

    const agent = await prisma.agent.create({
      data: {
        storeId,
        name,
        token,
      },
    });

    return reply.status(201).send({
      id: agent.id,
      name: agent.name,
      token,
      isActive: agent.isActive,
      createdAt: agent.createdAt,
    });
  });

  app.get("/store/agents", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const agents = await prisma.agent.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
    });

    return agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      isActive: agent.isActive,
      tokenMasked: maskToken(agent.token),
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    }));
  });

  app.post("/store/agents/:id/rotate-token", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const agent = await prisma.agent.findFirst({
      where: { id, storeId },
    });

    if (!agent) {
      return reply.status(404).send({ message: "Agent not found" });
    }

    const token = generateAgentToken();
    const updated = await prisma.agent.update({
      where: { id },
      data: { token },
    });

    return reply.send({
      token,
      agent: {
        id: updated.id,
        name: updated.name,
        isActive: updated.isActive,
        tokenMasked: maskToken(updated.token),
        updatedAt: updated.updatedAt,
      },
    });
  });

  app.patch("/store/agents/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      isActive: z.boolean().optional(),
      name: z.string().min(1).optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { isActive, name } = bodySchema.parse(request.body);

    const agent = await prisma.agent.findFirst({
      where: { id, storeId },
    });

    if (!agent) {
      return reply.status(404).send({ message: "Agent not found" });
    }

    const updated = await prisma.agent.update({
      where: { id },
      data: {
        isActive: isActive ?? agent.isActive,
        name: name ?? agent.name,
      },
    });

    return reply.send({
      id: updated.id,
      name: updated.name,
      isActive: updated.isActive,
      tokenMasked: maskToken(updated.token),
      updatedAt: updated.updatedAt,
    });
  });

  app.delete("/store/agents/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const agent = await prisma.agent.findFirst({
      where: { id, storeId },
    });

    if (!agent) {
      return reply.status(404).send({ message: "Agent not found" });
    }

    if (agent.isActive) {
      return reply
        .status(400)
        .send({ message: "Desative o agente antes de excluir." });
    }

    await prisma.agent.delete({ where: { id } });

    return reply.send({ ok: true });
  });

  app.get("/store/delivery-areas", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const areas = await prisma.deliveryArea.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return areas.map((area) => ({
      id: area.id,
      name: area.name,
      feeCents: area.feeCents,
      isActive: area.isActive,
      sortOrder: area.sortOrder,
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    }));
  });

  app.post("/store/delivery-areas", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      feeCents: z.number().int().nonnegative(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { name, feeCents, isActive, sortOrder } = bodySchema.parse(
      request.body
    );

    const area = await prisma.deliveryArea.create({
      data: {
        storeId,
        name,
        feeCents,
        isActive: isActive ?? true,
        sortOrder: sortOrder ?? 0,
      },
    });

    return reply.status(201).send({
      id: area.id,
      name: area.name,
      feeCents: area.feeCents,
      isActive: area.isActive,
      sortOrder: area.sortOrder,
      createdAt: area.createdAt,
      updatedAt: area.updatedAt,
    });
  });

  app.patch("/store/delivery-areas/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      feeCents: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, feeCents, isActive, sortOrder } = bodySchema.parse(
      request.body
    );

    const area = await prisma.deliveryArea.findFirst({
      where: { id, storeId },
    });

    if (!area) {
      return reply.status(404).send({ message: "Delivery area not found" });
    }

    const updated = await prisma.deliveryArea.update({
      where: { id },
      data: {
        name: name ?? area.name,
        feeCents: feeCents ?? area.feeCents,
        isActive: isActive ?? area.isActive,
        sortOrder: sortOrder ?? area.sortOrder,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      feeCents: updated.feeCents,
      isActive: updated.isActive,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.delete("/store/delivery-areas/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const area = await prisma.deliveryArea.findFirst({
      where: { id, storeId },
    });

    if (!area) {
      return reply.status(404).send({ message: "Delivery area not found" });
    }

    await prisma.deliveryArea.delete({ where: { id } });
    return reply.status(204).send();
  });

  app.get("/store/settings/hours", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const hours = await prisma.storeHours.findUnique({
      where: { storeId },
    });

    if (!hours) {
      return reply.send(defaultHours);
    }

    return reply.send({
      timezone: hours.timezone,
      monOpen: hours.monOpen,
      monClose: hours.monClose,
      monEnabled: hours.monEnabled,
      tueOpen: hours.tueOpen,
      tueClose: hours.tueClose,
      tueEnabled: hours.tueEnabled,
      wedOpen: hours.wedOpen,
      wedClose: hours.wedClose,
      wedEnabled: hours.wedEnabled,
      thuOpen: hours.thuOpen,
      thuClose: hours.thuClose,
      thuEnabled: hours.thuEnabled,
      friOpen: hours.friOpen,
      friClose: hours.friClose,
      friEnabled: hours.friEnabled,
      satOpen: hours.satOpen,
      satClose: hours.satClose,
      satEnabled: hours.satEnabled,
      sunOpen: hours.sunOpen,
      sunClose: hours.sunClose,
      sunEnabled: hours.sunEnabled,
      isOpenNowOverride: hours.isOpenNowOverride,
      closedMessage: hours.closedMessage,
    });
  });

  app.put("/store/settings/hours", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
    const bodySchema = z.object({
      timezone: z.string().min(1).optional(),
      monOpen: hhmm.nullable().optional(),
      monClose: hhmm.nullable().optional(),
      monEnabled: z.boolean().optional(),
      tueOpen: hhmm.nullable().optional(),
      tueClose: hhmm.nullable().optional(),
      tueEnabled: z.boolean().optional(),
      wedOpen: hhmm.nullable().optional(),
      wedClose: hhmm.nullable().optional(),
      wedEnabled: z.boolean().optional(),
      thuOpen: hhmm.nullable().optional(),
      thuClose: hhmm.nullable().optional(),
      thuEnabled: z.boolean().optional(),
      friOpen: hhmm.nullable().optional(),
      friClose: hhmm.nullable().optional(),
      friEnabled: z.boolean().optional(),
      satOpen: hhmm.nullable().optional(),
      satClose: hhmm.nullable().optional(),
      satEnabled: z.boolean().optional(),
      sunOpen: hhmm.nullable().optional(),
      sunClose: hhmm.nullable().optional(),
      sunEnabled: z.boolean().optional(),
      isOpenNowOverride: z
        .enum(["AUTO", "FORCE_OPEN", "FORCE_CLOSED"])
        .optional(),
      closedMessage: z.string().nullable().optional(),
    });

    const payload = bodySchema.parse(request.body);

    const createData: Prisma.StoreHoursUncheckedCreateInput = {
      storeId,
      timezone: payload.timezone ?? defaultHours.timezone,
      monOpen: payload.monOpen ?? null,
      monClose: payload.monClose ?? null,
      monEnabled: payload.monEnabled ?? false,
      tueOpen: payload.tueOpen ?? null,
      tueClose: payload.tueClose ?? null,
      tueEnabled: payload.tueEnabled ?? false,
      wedOpen: payload.wedOpen ?? null,
      wedClose: payload.wedClose ?? null,
      wedEnabled: payload.wedEnabled ?? false,
      thuOpen: payload.thuOpen ?? null,
      thuClose: payload.thuClose ?? null,
      thuEnabled: payload.thuEnabled ?? false,
      friOpen: payload.friOpen ?? null,
      friClose: payload.friClose ?? null,
      friEnabled: payload.friEnabled ?? false,
      satOpen: payload.satOpen ?? null,
      satClose: payload.satClose ?? null,
      satEnabled: payload.satEnabled ?? false,
      sunOpen: payload.sunOpen ?? null,
      sunClose: payload.sunClose ?? null,
      sunEnabled: payload.sunEnabled ?? false,
      isOpenNowOverride: payload.isOpenNowOverride ?? OpenOverride.AUTO,
      closedMessage: payload.closedMessage ?? null,
    };

    const updateData: Prisma.StoreHoursUncheckedUpdateInput = {
      timezone: payload.timezone ?? undefined,
      monOpen: payload.monOpen ?? null,
      monClose: payload.monClose ?? null,
      monEnabled: payload.monEnabled ?? undefined,
      tueOpen: payload.tueOpen ?? null,
      tueClose: payload.tueClose ?? null,
      tueEnabled: payload.tueEnabled ?? undefined,
      wedOpen: payload.wedOpen ?? null,
      wedClose: payload.wedClose ?? null,
      wedEnabled: payload.wedEnabled ?? undefined,
      thuOpen: payload.thuOpen ?? null,
      thuClose: payload.thuClose ?? null,
      thuEnabled: payload.thuEnabled ?? undefined,
      friOpen: payload.friOpen ?? null,
      friClose: payload.friClose ?? null,
      friEnabled: payload.friEnabled ?? undefined,
      satOpen: payload.satOpen ?? null,
      satClose: payload.satClose ?? null,
      satEnabled: payload.satEnabled ?? undefined,
      sunOpen: payload.sunOpen ?? null,
      sunClose: payload.sunClose ?? null,
      sunEnabled: payload.sunEnabled ?? undefined,
      isOpenNowOverride: payload.isOpenNowOverride ?? undefined,
      closedMessage: payload.closedMessage ?? null,
    };

    const hours = await prisma.$transaction(async (tx) => {
      const upserted = await tx.storeHours.upsert({
        where: { storeId },
        create: createData,
        update: updateData,
      });
      if (payload.timezone) {
        await tx.store.update({
          where: { id: storeId },
          data: { timezone: payload.timezone },
        });
      }
      return upserted;
    });

    return reply.send({
      timezone: hours.timezone,
      monOpen: hours.monOpen,
      monClose: hours.monClose,
      monEnabled: hours.monEnabled,
      tueOpen: hours.tueOpen,
      tueClose: hours.tueClose,
      tueEnabled: hours.tueEnabled,
      wedOpen: hours.wedOpen,
      wedClose: hours.wedClose,
      wedEnabled: hours.wedEnabled,
      thuOpen: hours.thuOpen,
      thuClose: hours.thuClose,
      thuEnabled: hours.thuEnabled,
      friOpen: hours.friOpen,
      friClose: hours.friClose,
      friEnabled: hours.friEnabled,
      satOpen: hours.satOpen,
      satClose: hours.satClose,
      satEnabled: hours.satEnabled,
      sunOpen: hours.sunOpen,
      sunClose: hours.sunClose,
      sunEnabled: hours.sunEnabled,
      isOpenNowOverride: hours.isOpenNowOverride,
      closedMessage: hours.closedMessage,
    });
  });

  app.get("/store/settings/payment", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const settings = await prisma.storePaymentSettings.findUnique({
      where: { storeId },
    });

    if (!settings) {
      return reply.send({
        acceptPix: true,
        acceptCash: true,
        acceptCard: true,
        requireChangeForCash: false,
        pixKey: null,
        pixName: null,
        pixBank: null,
      });
    }

    return reply.send({
      acceptPix: settings.acceptPix,
      acceptCash: settings.acceptCash,
      acceptCard: settings.acceptCard,
      requireChangeForCash: settings.requireChangeForCash,
      pixKey: settings.pixKey,
      pixName: settings.pixName,
      pixBank: settings.pixBank,
    });
  });

  app.put("/store/settings/payment", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      acceptPix: z.boolean().optional(),
      acceptCash: z.boolean().optional(),
      acceptCard: z.boolean().optional(),
      requireChangeForCash: z.boolean().optional(),
      pixKey: z.string().nullable().optional(),
      pixName: z.string().nullable().optional(),
      pixBank: z.string().nullable().optional(),
    });

    const payload = bodySchema.parse(request.body);

    const settings = await prisma.storePaymentSettings.upsert({
      where: { storeId },
      create: {
        storeId,
        acceptPix: payload.acceptPix ?? true,
        acceptCash: payload.acceptCash ?? true,
        acceptCard: payload.acceptCard ?? true,
        requireChangeForCash: payload.requireChangeForCash ?? false,
        pixKey: payload.pixKey ?? null,
        pixName: payload.pixName ?? null,
        pixBank: payload.pixBank ?? null,
      },
      update: {
        acceptPix: payload.acceptPix ?? undefined,
        acceptCash: payload.acceptCash ?? undefined,
        acceptCard: payload.acceptCard ?? undefined,
        requireChangeForCash: payload.requireChangeForCash ?? undefined,
        pixKey: payload.pixKey ?? null,
        pixName: payload.pixName ?? null,
        pixBank: payload.pixBank ?? null,
      },
    });

    return reply.send({
      acceptPix: settings.acceptPix,
      acceptCash: settings.acceptCash,
      acceptCard: settings.acceptCard,
      requireChangeForCash: settings.requireChangeForCash,
      pixKey: settings.pixKey,
      pixName: settings.pixName,
      pixBank: settings.pixBank,
    });
  });

  app.get("/store/orders/stream", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Keep-Alive", "timeout=120");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    reply.raw.write("retry: 10000\n");
    reply.raw.write(":ok\n\n");
    reply.raw.setTimeout(0);

    const clients = orderStreamClients.get(storeId) ?? new Set();
    clients.add(reply);
    orderStreamClients.set(storeId, clients);
    const pingIntervalMs = 15000 + Math.floor(Math.random() * 10000);
    const pingInterval = setInterval(() => {
      try {
        reply.raw.write("event: ping\ndata: {}\n\n");
      } catch {
        const activeClients = orderStreamClients.get(storeId);
        activeClients?.delete(reply);
        const ping = orderStreamPingers.get(reply);
        if (ping) {
          clearInterval(ping);
          orderStreamPingers.delete(reply);
        }
      }
    }, pingIntervalMs);
    orderStreamPingers.set(reply, pingInterval);

    request.raw.on("close", () => {
      const activeClients = orderStreamClients.get(storeId);
      if (!activeClients) {
        return;
      }
      activeClients.delete(reply);
      if (activeClients.size === 0) {
        orderStreamClients.delete(storeId);
      }
      const ping = orderStreamPingers.get(reply);
      if (ping) {
        clearInterval(ping);
        orderStreamPingers.delete(reply);
      }
    });

    return reply.raw;
  });

  app.get("/store/salon/stream", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    reply.hijack();
    reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("Keep-Alive", "timeout=120");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders?.();
    reply.raw.write("retry: 10000\n");
    reply.raw.write(":ok\n\n");
    reply.raw.setTimeout(0);

    const clients = salonStreamClients.get(storeId) ?? new Set();
    clients.add(reply);
    salonStreamClients.set(storeId, clients);
    const pingIntervalMs = 25000 + Math.floor(Math.random() * 5000);
    const pingInterval = setInterval(() => {
      try {
        reply.raw.write("event: ping\ndata: {}\n\n");
      } catch {
        const activeClients = salonStreamClients.get(storeId);
        activeClients?.delete(reply);
        const ping = salonStreamPingers.get(reply);
        if (ping) {
          clearInterval(ping);
          salonStreamPingers.delete(reply);
        }
      }
    }, pingIntervalMs);
    salonStreamPingers.set(reply, pingInterval);

    request.raw.on("close", () => {
      const activeClients = salonStreamClients.get(storeId);
      if (!activeClients) {
        return;
      }
      activeClients.delete(reply);
      if (activeClients.size === 0) {
        salonStreamClients.delete(storeId);
      }
      const ping = salonStreamPingers.get(reply);
      if (ping) {
        clearInterval(ping);
        salonStreamPingers.delete(reply);
      }
    });

    return reply.raw;
  });

  app.get("/store/salon/settings", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: {
        salonEnabled: true,
        salonTableCount: true,
        cashierPrintEnabled: true,
        waiterPinHash: true,
        waiterPwaEnabled: true,
      },
    });

    if (!store) {
      return reply.status(404).send({ message: "Store not found" });
    }

    return reply.send({
      salonEnabled: store.salonEnabled,
      salonTableCount: store.salonTableCount,
      cashierPrintEnabled: store.cashierPrintEnabled,
      waiterPinSet: Boolean(store.waiterPinHash),
      waiterPwaEnabled: store.waiterPwaEnabled,
    });
  });

  app.patch("/store/salon/settings", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      salonEnabled: z.boolean().optional(),
      salonTableCount: z.number().int().nonnegative().optional(),
      cashierPrintEnabled: z.boolean().optional(),
      waiterPwaEnabled: z.boolean().optional(),
      waiterPin: z
        .string()
        .refine(
          (value) => /^\d{4}$|^\d{6}$/.test(value),
          "PIN deve ter 4 ou 6 dígitos."
        )
        .optional(),
    });

    const payload = bodySchema.parse(request.body ?? {});

    try {
      const store = await prisma.$transaction(async (tx) => {
        const waiterPinHash = payload.waiterPin
          ? await bcrypt.hash(payload.waiterPin, 10)
          : undefined;

        const updated = await tx.store.update({
          where: { id: storeId },
          data: {
            salonEnabled: payload.salonEnabled ?? undefined,
            salonTableCount: payload.salonTableCount ?? undefined,
            cashierPrintEnabled: payload.cashierPrintEnabled ?? undefined,
            waiterPwaEnabled: payload.waiterPwaEnabled ?? undefined,
            waiterPinHash,
          },
          select: {
            salonEnabled: true,
            salonTableCount: true,
            cashierPrintEnabled: true,
            waiterPinHash: true,
            waiterPwaEnabled: true,
          },
        });

        if (payload.salonTableCount !== undefined) {
          await syncSalonTables(tx, storeId, payload.salonTableCount);
        }

        return updated;
      });

      sendSalonStreamEvent(storeId, { reason: "settings" });

      return reply.send({
        salonEnabled: store.salonEnabled,
        salonTableCount: store.salonTableCount,
        cashierPrintEnabled: store.cashierPrintEnabled,
        waiterPinSet: Boolean(store.waiterPinHash),
        waiterPwaEnabled: store.waiterPwaEnabled,
      });
    } catch (error) {
      return reply.status(400).send({
        message:
          error instanceof Error
            ? error.message
            : "Não foi possível atualizar as mesas.",
      });
    }
  });

  app.get("/store/salon/tables", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { salonEnabled: true, cashierPrintEnabled: true },
    });
    if (!store?.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    const tables = await prisma.salonTable.findMany({
      where: { storeId },
      orderBy: { number: "asc" },
    });
    const activeSessions = tables
      .filter(
        (table) =>
          table.status === TableStatus.OPEN && table.currentSessionId
      )
      .map((table) => ({
        tableId: table.id,
        tableSessionId: table.currentSessionId!,
      }));
    const totals = activeSessions.length
      ? await prisma.order.groupBy({
          by: ["tableId", "tableSessionId"],
          where: {
            storeId,
            orderType: "DINE_IN",
            OR: activeSessions.map((session) => ({
              tableId: session.tableId,
              tableSessionId: session.tableSessionId,
            })),
          },
          _sum: { total: true },
          _max: { createdAt: true },
        })
      : [];
    const totalsMap = new Map(
      totals.map((item) => [`${item.tableId}:${item.tableSessionId}`, item])
    );

    return reply.send(
      tables.map((table) => {
        const summary =
          table.status === TableStatus.OPEN && table.currentSessionId
            ? totalsMap.get(
                `${table.id}:${table.currentSessionId}`
              )
            : undefined;
        const total = summary?._sum.total
          ? summary._sum.total.toNumber()
          : 0;
        const lastOrderAt = summary?._max.createdAt ?? null;
        return {
          id: table.id,
          number: table.number,
          status: table.status,
          openedAt: table.openedAt,
          closedAt: table.closedAt,
          total,
          lastOrderAt,
        };
      })
    );
  });

  app.get("/store/salon/tables/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { salonEnabled: true, cashierPrintEnabled: true },
    });
    if (!store?.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    const table = await prisma.salonTable.findFirst({
      where: { id, storeId },
    });
    if (!table) {
      return reply.status(404).send({ message: "Mesa não encontrada." });
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const orders =
      table.status === TableStatus.OPEN && table.currentSessionId
        ? await prisma.order.findMany({
            where: {
              storeId,
              orderType: "DINE_IN",
              tableId: table.id,
              tableSessionId: table.currentSessionId,
              createdAt: { gte: sevenDaysAgo },
            },
            include: {
              items: {
                include: {
                  product: true,
                  options: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
          })
        : [];

    const total = orders.reduce(
      (acc, order) => acc + order.total.toNumber(),
      0
    );
    const lastOrderAt = orders[0]?.createdAt ?? null;

    return reply.send({
      table: {
        id: table.id,
        number: table.number,
        status: table.status,
        openedAt: table.openedAt,
        closedAt: table.closedAt,
        total,
        lastOrderAt,
      },
      orders: orders.map((order) => ({
        id: order.id,
        shortId: order.id.slice(0, 6),
        status: order.status,
        total: order.total.toNumber(),
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          id: item.id,
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: item.unitPriceCents / 100,
          notes: item.notes,
          options: item.options.map((option) => ({
            id: option.id,
            groupName: option.groupName,
            itemName: option.itemName,
            priceDeltaCents: option.priceDeltaCents,
          })),
        })),
      })),
    });
  });

  app.post("/store/salon/tables/:id/open", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { salonEnabled: true, cashierPrintEnabled: true },
    });
    if (!store?.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    const table = await prisma.salonTable.findFirst({
      where: { id, storeId },
    });
    if (!table) {
      return reply.status(404).send({ message: "Mesa não encontrada." });
    }

    if (table.status === TableStatus.OPEN && table.currentSessionId) {
      return reply.send({ ok: true });
    }

    await prisma.salonTable.update({
      where: { id: table.id },
      data: {
        status: TableStatus.OPEN,
        openedAt: new Date(),
        closedAt: null,
        currentSessionId: randomUUID(),
      },
    });

    sendSalonStreamEvent(storeId, { reason: "open" });
    return reply.send({ ok: true });
  });

  app.post("/store/salon/tables/:id/close", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { salonEnabled: true, cashierPrintEnabled: true },
    });
    if (!store?.salonEnabled) {
      return reply.status(400).send({
        message: "Modo salão não está habilitado para esta loja.",
      });
    }

    const table = await prisma.salonTable.findFirst({
      where: { id, storeId },
    });
    if (!table) {
      return reply.status(404).send({ message: "Mesa não encontrada." });
    }

    if (table.status !== TableStatus.OPEN) {
      return reply.status(400).send({
        message: "A mesa precisa estar aberta para ser fechada.",
      });
    }

    const summary = await buildTableSessionSummary(prisma, {
      storeId,
      tableId: table.id,
      tableSessionId: table.currentSessionId,
    });

    await prisma.$transaction(async (tx) => {
      const closedAt = new Date();
      const subtotalCents = summary.totalCents;
      const serviceFeeCents = 0;
      const totalCents = subtotalCents + serviceFeeCents;
      const closedAtIso = closedAt.toISOString();

      await tx.printJob.create({
        data: {
          storeId: table.storeId,
          type: PrintJobType.CASHIER_TABLE_SUMMARY,
          status: PrintJobStatus.QUEUED,
          tableId: table.id,
          tableSessionId: table.currentSessionId,
          payload: {
            tableId: table.id,
            tableNumber: table.number,
            sessionId: table.currentSessionId,
            closedAt: closedAtIso,
            items: summary.items,
            subtotalCents,
            serviceFeeCents,
            totalCents,
          },
        },
      });

      await tx.salonTable.update({
        where: { id: table.id },
        data: {
          status: TableStatus.FREE,
          closedAt,
          openedAt: null,
          currentSessionId: null,
        },
      });
    });

    sendSalonStreamEvent(storeId, { reason: "close" });
    return reply.send({ ok: true });
  });

  app.get("/store/print-jobs/:id/pdf", async (request, reply) => {
    const storeId = request.storeId;
    const adminId = request.adminId;
    if (!storeId && !adminId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const printJob = await prisma.printJob.findUnique({
      where: { id },
      include: { store: true },
    });

    if (!printJob) {
      return reply.status(404).send({ message: "Impressão não encontrada." });
    }

    if (storeId && printJob.storeId !== storeId) {
      return reply.status(404).send({ message: "Impressão não encontrada." });
    }

    if (printJob.type !== PrintJobType.CASHIER_TABLE_SUMMARY) {
      return reply.status(400).send({
        message: "Este job não possui resumo de mesa.",
      });
    }

    if (!printJob.tableId) {
      return reply.status(400).send({
        message: "Mesa não informada para este job.",
      });
    }

    const table = await prisma.salonTable.findFirst({
      where: { id: printJob.tableId, storeId: printJob.storeId },
      select: { number: true },
    });

    if (!table) {
      return reply.status(404).send({ message: "Mesa não encontrada." });
    }

    const summary = await buildTableSessionSummary(prisma, {
      storeId: printJob.storeId,
      tableId: printJob.tableId,
      tableSessionId: printJob.tableSessionId,
    });

    const pdf = buildTableSummaryPdf({
      store: printJob.store,
      tableNumber: table.number,
      items: summary.items,
      totalCents: summary.totalCents,
      closedAt: printJob.createdAt,
    });

    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=table-summary-${printJob.id}.pdf`
    );

    return reply.send(pdf);
  });

  app.get("/store/orders", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const querySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]).optional(),
      since: z.string().datetime().optional(),
    });

    const { status, since } = querySchema.parse(request.query);

    const orders = await prisma.order.findMany({
      where: {
        storeId,
        status,
        createdAt: since ? { gt: new Date(since) } : undefined,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return orders.map((order) => ({
      id: order.id,
      shortId: order.id.slice(0, 6),
      customerName: order.customerName,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      total: order.total.toNumber(),
      deliveryFeeCents: order.deliveryFeeCents,
      convenienceFeeCents: order.convenienceFeeCents,
      convenienceFeeLabel: order.convenienceFeeLabel,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      createdAt: order.createdAt,
    }));
  });

  app.get("/store/categories", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const categories = await prisma.category.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }));
  });

  app.post("/store/categories", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      active: z.boolean().optional(),
    });

    const { name, active } = bodySchema.parse(request.body);

    const category = await prisma.$transaction(async (tx) => {
      const maxSortOrder = await tx.category.aggregate({
        where: { storeId },
        _max: { sortOrder: true },
      });
      const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

      return tx.category.create({
        data: {
          name,
          active: active ?? true,
          storeId,
          sortOrder: nextSortOrder,
        },
      });
    });

    await emitMenuUpdateByStoreId(storeId);

    return reply.status(201).send({
      id: category.id,
      name: category.name,
      active: category.active,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    });
  });

  app.patch("/store/categories/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      active: z.boolean().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const { name, active } = bodySchema.parse(request.body);

    if (!name && active === undefined) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const category = await prisma.category.findFirst({
      where: { id, storeId },
    });

    if (!category) {
      return reply.status(404).send({ message: "Category not found" });
    }

    const updated = await prisma.category.update({
      where: { id },
      data: {
        name: name ?? category.name,
        active: active ?? category.active,
      },
    });

    await emitMenuUpdateByStoreId(storeId);

    return {
      id: updated.id,
      name: updated.name,
      active: updated.active,
      sortOrder: updated.sortOrder,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.delete("/store/categories/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const category = await prisma.category.findFirst({
      where: { id, storeId },
    });

    if (!category) {
      return reply.status(404).send({ message: "Category not found" });
    }

    if (category.active) {
      return reply
        .status(400)
        .send({ message: "Não é possível apagar uma categoria ativa." });
    }

    const productsCount = await prisma.product.count({
      where: { categoryId: id },
    });

    if (productsCount > 0) {
      return reply.status(400).send({
        message:
          "Não é possível apagar a categoria porque existem produtos vinculados.",
      });
    }

    await prisma.category.delete({
      where: { id },
    });

    await emitMenuUpdateByStoreId(storeId);

    return reply.status(204).send();
  });

  app.post("/store/categories/:id/move", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      direction: z.enum(["up", "down"]),
    });

    const { id } = paramsSchema.parse(request.params);
    const { direction } = bodySchema.parse(request.body);

    const categories = await prisma.category.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    const currentIndex = categories.findIndex((category) => category.id === id);
    if (currentIndex === -1) {
      return reply.status(404).send({ message: "Category not found" });
    }

    const neighborIndex =
      direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (neighborIndex < 0 || neighborIndex >= categories.length) {
      return reply
        .status(400)
        .send({ message: "Cannot move category in that direction" });
    }

    const currentCategory = categories[currentIndex];
    const neighborCategory = categories[neighborIndex];

    await prisma.$transaction([
      prisma.category.update({
        where: { id: currentCategory.id },
        data: { sortOrder: neighborCategory.sortOrder },
      }),
      prisma.category.update({
        where: { id: neighborCategory.id },
        data: { sortOrder: currentCategory.sortOrder },
      }),
    ]);

    await emitMenuUpdateByStoreId(storeId);

    const updatedCategories = await prisma.category.findMany({
      where: { storeId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return updatedCategories.map((category) => ({
      id: category.id,
      name: category.name,
      active: category.active,
      sortOrder: category.sortOrder,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    }));
  });

  app.get("/store/products", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const products = await prisma.product.findMany({
      where: {
        category: {
          storeId,
        },
      },
      include: {
        category: true,
        availabilityWindows: { orderBy: { startMinute: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.price.toNumber(),
      active: product.active,
      isPromo: product.isPromo,
      pricingRule: product.pricingRule,
      availableDays: product.availableDays,
      availabilityWindows: product.availabilityWindows.map((window) => ({
        id: window.id,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        active: window.active,
      })),
      categoryId: product.categoryId,
      categoryName: product.category.name,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    }));
  });

  app.post("/store/products", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const bodySchema = z.object({
      name: z.string().min(1),
      categoryId: z.string().uuid(),
      price: z.number().nonnegative(),
      active: z.boolean().optional(),
      isPromo: z.boolean().optional(),
      pricingRule: z.enum(["SUM", "MAX_OPTION", "HALF_SUM"]).optional(),
      availableDays: z.array(z.number().int().min(1).max(7)).optional(),
      availabilityWindows: z
        .array(
          z.object({
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(1).max(1440),
            active: z.boolean().optional(),
          })
        )
        .optional(),
    });

    const {
      name,
      categoryId,
      price,
      active,
      isPromo,
      pricingRule,
      availableDays,
      availabilityWindows,
    } = bodySchema.parse(
      request.body
    );
    const normalizedAvailableDays =
      availableDays && availableDays.length > 0 ? availableDays : [];
    const normalizedAvailabilityWindows =
      availabilityWindows === undefined
        ? undefined
        : normalizeAvailabilityWindows(availabilityWindows);
    if (
      normalizedAvailabilityWindows &&
      normalizedAvailabilityWindows.ok === false
    ) {
      return reply
        .status(400)
        .send({ message: normalizedAvailabilityWindows.message });
    }

    const category = await prisma.category.findFirst({
      where: { id: categoryId, storeId },
    });

    if (!category) {
      return reply.status(404).send({ message: "Category not found" });
    }

    const product = await prisma.product.create({
      data: {
        name,
        price,
        active: active ?? true,
        isPromo: isPromo ?? false,
        pricingRule: pricingRule ?? "SUM",
        categoryId,
        availableDays: normalizedAvailableDays,
        availabilityWindows:
          normalizedAvailabilityWindows &&
          normalizedAvailabilityWindows.ok === true &&
          normalizedAvailabilityWindows.windows.length > 0
            ? {
                create: normalizedAvailabilityWindows.windows.map((window) => ({
                  startMinute: window.startMinute,
                  endMinute: window.endMinute,
                  active: window.active,
                })),
              }
            : undefined,
      },
      include: { availabilityWindows: { orderBy: { startMinute: "asc" } } },
    });

    const menuUpdateReason: MenuUpdateReason =
      isPromo === true ? "promo" : "product_update";
    await emitMenuUpdateByStoreId(storeId, menuUpdateReason);

    return reply.status(201).send({
      id: product.id,
      name: product.name,
      price: product.price.toNumber(),
      active: product.active,
      isPromo: product.isPromo,
      pricingRule: product.pricingRule,
      availableDays: product.availableDays,
      availabilityWindows: product.availabilityWindows.map((window) => ({
        id: window.id,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        active: window.active,
      })),
      categoryId: product.categoryId,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    });
  });

  app.patch("/store/products/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      price: z.number().nonnegative().optional(),
      categoryId: z.string().uuid().optional(),
      active: z.boolean().optional(),
      isPromo: z.boolean().optional(),
      pricingRule: z.enum(["SUM", "MAX_OPTION", "HALF_SUM"]).optional(),
      availableDays: z.array(z.number().int().min(1).max(7)).optional(),
      availabilityWindows: z
        .array(
          z.object({
            startMinute: z.number().int().min(0).max(1439),
            endMinute: z.number().int().min(1).max(1440),
            active: z.boolean().optional(),
          })
        )
        .optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const {
      name,
      price,
      categoryId,
      active,
      isPromo,
      pricingRule,
      availableDays,
      availabilityWindows,
    } = bodySchema.parse(
      request.body
    );
    const normalizedAvailableDays =
      availableDays && availableDays.length > 0 ? availableDays : [];
    const normalizedAvailabilityWindows =
      availabilityWindows === undefined
        ? undefined
        : normalizeAvailabilityWindows(availabilityWindows);
    if (
      normalizedAvailabilityWindows &&
      normalizedAvailabilityWindows.ok === false
    ) {
      return reply
        .status(400)
        .send({ message: normalizedAvailabilityWindows.message });
    }

    if (
      !name &&
      price === undefined &&
      !categoryId &&
      active === undefined &&
      isPromo === undefined &&
      pricingRule === undefined &&
      availableDays === undefined &&
      availabilityWindows === undefined
    ) {
      return reply.status(400).send({ message: "No changes provided" });
    }

    const product = await prisma.product.findFirst({
      where: {
        id,
        category: {
          storeId,
        },
      },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    if (categoryId) {
      const category = await prisma.category.findFirst({
        where: { id: categoryId, storeId },
      });
      if (!category) {
        return reply.status(404).send({ message: "Category not found" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProduct = await tx.product.update({
        where: { id },
        data: {
          name: name ?? product.name,
          price: price ?? product.price,
          active: active ?? product.active,
          isPromo: isPromo ?? product.isPromo,
          pricingRule: pricingRule ?? product.pricingRule,
          categoryId: categoryId ?? product.categoryId,
          availableDays:
            availableDays === undefined
              ? product.availableDays
              : normalizedAvailableDays,
        },
      });

      if (
        normalizedAvailabilityWindows &&
        normalizedAvailabilityWindows.ok === true
      ) {
        await tx.productAvailabilityWindow.deleteMany({
          where: { productId: id },
        });
        if (normalizedAvailabilityWindows.windows.length > 0) {
          await tx.productAvailabilityWindow.createMany({
            data: normalizedAvailabilityWindows.windows.map((window) => ({
              productId: id,
              startMinute: window.startMinute,
              endMinute: window.endMinute,
              active: window.active,
            })),
          });
        }
      }

      return updatedProduct;
    });

    const updatedWindows = await prisma.productAvailabilityWindow.findMany({
      where: { productId: updated.id },
      orderBy: { startMinute: "asc" },
    });

    const menuUpdateReason: MenuUpdateReason =
      isPromo !== undefined && isPromo !== product.isPromo
        ? "promo"
        : "product_update";
    await emitMenuUpdateByStoreId(storeId, menuUpdateReason);

    return {
      id: updated.id,
      name: updated.name,
      price: updated.price.toNumber(),
      active: updated.active,
      isPromo: updated.isPromo,
      pricingRule: updated.pricingRule,
      availableDays: updated.availableDays,
      availabilityWindows: updatedWindows.map((window) => ({
        id: window.id,
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        active: window.active,
      })),
      categoryId: updated.categoryId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  });

  app.delete("/store/products/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const product = await prisma.product.findFirst({
      where: { id, category: { storeId } },
      select: { id: true, active: true },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    if (product.active) {
      return reply.status(400).send({
        message: "Produto precisa estar desativado para ser excluído",
      });
    }

    const orderItemsCount = await prisma.orderItem.count({
      where: { productId: product.id },
    });

    if (orderItemsCount > 0) {
      return reply.status(400).send({
        message: "Produto não pode ser excluído pois já possui pedidos",
      });
    }

    await prisma.product.delete({ where: { id: product.id } });
    await emitMenuUpdateByStoreId(storeId, "product_update");

    return reply.status(204).send();
  });

  app.get("/store/products/:id/option-groups", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const product = await prisma.product.findFirst({
      where: { id, category: { storeId } },
      include: {
        optionGroups: {
          include: {
            items: true,
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    return reply.send(
      product.optionGroups.map((group) => ({
        id: group.id,
        productId: group.productId,
        name: group.name,
        type: group.type,
        required: group.required,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        sortOrder: group.sortOrder,
        items: group.items
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((item) => ({
            id: item.id,
            groupId: item.groupId,
            name: item.name,
            priceDeltaCents: item.priceDeltaCents,
            isActive: item.isActive,
            sortOrder: item.sortOrder,
          })),
      }))
    );
  });

  app.post("/store/products/:id/option-groups", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1),
      type: z.enum(["SINGLE", "MULTI"]),
      required: z.boolean().optional(),
      minSelect: z.number().int().nonnegative().optional(),
      maxSelect: z.number().int().nonnegative().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { id } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const product = await prisma.product.findFirst({
      where: { id, category: { storeId } },
    });

    if (!product) {
      return reply.status(404).send({ message: "Product not found" });
    }

    const normalizedRules = normalizeOptionGroupRules({
      type: payload.type,
      required: payload.required ?? false,
      minSelect: payload.minSelect ?? 0,
      maxSelect: payload.maxSelect ?? 0,
    });

    if (!normalizedRules.ok) {
      return reply.status(400).send({ message: normalizedRules.message });
    }

    const group = await prisma.productOptionGroup.create({
      data: {
        productId: product.id,
        name: payload.name,
        type: payload.type,
        required: payload.required ?? false,
        minSelect: normalizedRules.minSelect,
        maxSelect: normalizedRules.maxSelect,
        sortOrder: payload.sortOrder ?? 0,
      },
    });

    await emitMenuUpdateByStoreId(storeId);

    return reply.status(201).send({
      id: group.id,
      productId: group.productId,
      name: group.name,
      type: group.type,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      sortOrder: group.sortOrder,
    });
  });

  app.put("/store/option-groups/:groupId", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1).optional(),
      type: z.enum(["SINGLE", "MULTI"]).optional(),
      required: z.boolean().optional(),
      minSelect: z.number().int().nonnegative().optional(),
      maxSelect: z.number().int().nonnegative().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { groupId } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: {
          category: { storeId },
        },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const updatedType = payload.type ?? group.type;
    const updatedRequired = payload.required ?? group.required;
    const updatedMin = payload.minSelect ?? group.minSelect;
    const updatedMax = payload.maxSelect ?? group.maxSelect;
    const normalizedRules = normalizeOptionGroupRules({
      type: updatedType,
      required: updatedRequired,
      minSelect: updatedMin,
      maxSelect: updatedMax,
    });

    if (!normalizedRules.ok) {
      return reply.status(400).send({ message: normalizedRules.message });
    }

    const updated = await prisma.productOptionGroup.update({
      where: { id: groupId },
      data: {
        name: payload.name ?? group.name,
        type: updatedType,
        required: updatedRequired,
        minSelect: normalizedRules.minSelect,
        maxSelect: normalizedRules.maxSelect,
        sortOrder: payload.sortOrder ?? group.sortOrder,
      },
    });

    await emitMenuUpdateByStoreId(storeId);

    return reply.send({
      id: updated.id,
      productId: updated.productId,
      name: updated.name,
      type: updated.type,
      required: updated.required,
      minSelect: updated.minSelect,
      maxSelect: updated.maxSelect,
      sortOrder: updated.sortOrder,
    });
  });

  app.delete("/store/option-groups/:groupId", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const { groupId } = paramsSchema.parse(request.params);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: {
          category: { storeId },
        },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    await prisma.productOptionGroup.delete({ where: { id: groupId } });
    await emitMenuUpdateByStoreId(storeId);
    return reply.status(204).send();
  });

  app.get("/store/option-groups/:groupId/items", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const { groupId } = paramsSchema.parse(request.params);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: { category: { storeId } },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const items = await prisma.productOptionItem.findMany({
      where: { groupId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });

    return reply.send(
      items.map((item) => ({
        id: item.id,
        groupId: item.groupId,
        name: item.name,
        priceDeltaCents: item.priceDeltaCents,
        isActive: item.isActive,
        sortOrder: item.sortOrder,
      }))
    );
  });

  app.post("/store/option-groups/:groupId/items", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ groupId: z.string().uuid() });
    const bodySchema = z.object({
      name: z.string().min(1),
      priceDeltaCents: z.number().int().optional(),
      isActive: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
    });

    const { groupId } = paramsSchema.parse(request.params);
    const payload = bodySchema.parse(request.body);

    const group = await prisma.productOptionGroup.findFirst({
      where: {
        id: groupId,
        product: { category: { storeId } },
      },
    });

    if (!group) {
      return reply.status(404).send({ message: "Option group not found" });
    }

    const item = await prisma.productOptionItem.create({
      data: {
        groupId,
        name: payload.name,
        priceDeltaCents: payload.priceDeltaCents ?? 0,
        isActive: payload.isActive ?? true,
        sortOrder: payload.sortOrder ?? 0,
      },
    });

    await emitMenuUpdateByStoreId(storeId);

    return reply.status(201).send({
      id: item.id,
      groupId: item.groupId,
      name: item.name,
      priceDeltaCents: item.priceDeltaCents,
      isActive: item.isActive,
      sortOrder: item.sortOrder,
    });
  });

  app.put(
    "/store/option-groups/:groupId/items/:itemId",
    async (request, reply) => {
      const storeId = request.storeId;
      if (!storeId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const paramsSchema = z.object({
        groupId: z.string().uuid(),
        itemId: z.string().uuid(),
      });
      const bodySchema = z.object({
        name: z.string().min(1).optional(),
        priceDeltaCents: z.number().int().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      });

      const { groupId, itemId } = paramsSchema.parse(request.params);
      const payload = bodySchema.parse(request.body);

      const group = await prisma.productOptionGroup.findFirst({
        where: {
          id: groupId,
          product: { category: { storeId } },
        },
      });

      if (!group) {
        return reply.status(404).send({ message: "Option group not found" });
      }

      const item = await prisma.productOptionItem.findFirst({
        where: { id: itemId, groupId },
      });

      if (!item) {
        return reply.status(404).send({ message: "Option item not found" });
      }

      const updated = await prisma.productOptionItem.update({
        where: { id: itemId },
        data: {
          name: payload.name ?? item.name,
          priceDeltaCents: payload.priceDeltaCents ?? item.priceDeltaCents,
          isActive: payload.isActive ?? item.isActive,
          sortOrder: payload.sortOrder ?? item.sortOrder,
        },
      });

      await emitMenuUpdateByStoreId(storeId);

      return reply.send({
        id: updated.id,
        groupId: updated.groupId,
        name: updated.name,
        priceDeltaCents: updated.priceDeltaCents,
        isActive: updated.isActive,
        sortOrder: updated.sortOrder,
      });
    }
  );

  app.delete(
    "/store/option-groups/:groupId/items/:itemId",
    async (request, reply) => {
      const storeId = request.storeId;
      if (!storeId) {
        return reply.status(401).send({ message: "Unauthorized" });
      }

      const paramsSchema = z.object({
        groupId: z.string().uuid(),
        itemId: z.string().uuid(),
      });
      const { groupId, itemId } = paramsSchema.parse(request.params);

      const group = await prisma.productOptionGroup.findFirst({
        where: {
          id: groupId,
          product: { category: { storeId } },
        },
      });

      if (!group) {
        return reply.status(404).send({ message: "Option group not found" });
      }

      const item = await prisma.productOptionItem.findFirst({
        where: { id: itemId, groupId },
      });

      if (!item) {
        return reply.status(404).send({ message: "Option item not found" });
      }

      await prisma.productOptionItem.delete({ where: { id: itemId } });
      await emitMenuUpdateByStoreId(storeId);
      return reply.status(204).send();
    }
  );

  app.get("/store/orders/:id", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
      include: {
        items: {
          include: {
            product: true,
            options: true,
          },
        },
        deliveryArea: true,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    return {
      id: order.id,
      shortId: order.id.slice(0, 6),
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      fulfillmentType: order.fulfillmentType,
      notes: order.notes,
      addressLine: order.addressLine,
      addressNumber: order.addressNumber,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressReference: order.addressReference,
      deliveryArea: order.deliveryArea
        ? {
            id: order.deliveryArea.id,
            name: order.deliveryArea.name,
            feeCents: order.deliveryArea.feeCents,
          }
        : null,
      deliveryFeeCents: order.deliveryFeeCents,
      convenienceFeeCents: order.convenienceFeeCents,
      convenienceFeeLabel: order.convenienceFeeLabel,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      paidStatus: order.paidStatus,
      status: order.status,
      total: order.total.toNumber(),
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        unitPrice: item.unitPriceCents / 100,
        notes: item.notes,
        options: item.options.map((option) => ({
          id: option.id,
          groupName: option.groupName,
          itemName: option.itemName,
          priceDeltaCents: option.priceDeltaCents,
        })),
      })),
    };
  });

  app.post("/store/orders/:id/reprint", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: "NEW", printingClaimedAt: null },
    });

    sendOrderStreamEvent(storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.patch("/store/orders/:id/printing", async (request, reply) => {
    const storeId = request.storeId;
    if (!storeId) {
      return reply.status(401).send({ message: "Unauthorized" });
    }

    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const bodySchema = z.object({}).optional();
    bodySchema.parse(request.body ?? {});

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    if (order.status !== "NEW") {
      return reply.send({
        id: order.id,
        shortId: order.id.slice(0, 6),
        customerName: order.customerName,
        status: order.status,
        fulfillmentType: order.fulfillmentType,
        total: order.total.toNumber(),
        createdAt: order.createdAt,
      });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: "PRINTING", printingClaimedAt: new Date() },
    });

    sendOrderStreamEvent(storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId,
    });

    return {
      id: updated.id,
      shortId: updated.id.slice(0, 6),
      customerName: updated.customerName,
      status: updated.status,
      fulfillmentType: updated.fulfillmentType,
      total: updated.total.toNumber(),
      createdAt: updated.createdAt,
    };
  });

  app.get("/agent/me", async (request) => {
    const agent = (request as typeof request & {
      agent: { id: string; storeId: string; name: string; isActive: boolean };
    }).agent;

    return {
      id: agent.id,
      name: agent.name,
      storeId: agent.storeId,
      isActive: agent.isActive,
    };
  });

  app.get("/agent/orders", async (request) => {
    const querySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]).optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    });

    const { status, limit } = querySchema.parse(request.query);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const orders = await prisma.order.findMany({
      where: {
        storeId: agent.storeId,
        status: status ?? "PRINTING",
      },
      include: {
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: limit ?? 10,
    });

    const tableIds = [
      ...new Set(
        orders
          .map((order) => order.tableId)
          .filter((tableId): tableId is string => Boolean(tableId))
      ),
    ];
    const tables =
      tableIds.length > 0
        ? await prisma.salonTable.findMany({
            where: { id: { in: tableIds } },
            select: { id: true, number: true },
          })
        : [];
    const tableNumberById = new Map(
      tables.map((table) => [table.id, table.number])
    );

    return orders.map((order) => ({
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      paidStatus: order.paidStatus,
      deliveryFeeCents: order.deliveryFeeCents,
      convenienceFeeCents: order.convenienceFeeCents,
      convenienceFeeLabel: order.convenienceFeeLabel,
      notes: order.notes,
      addressLine: order.addressLine,
      addressNumber: order.addressNumber,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressReference: order.addressReference,
      tableId: order.tableId,
      tableSessionId: order.tableSessionId,
      tableNumber: order.tableId
        ? (tableNumberById.get(order.tableId) ?? null)
        : null,
      total: order.total.toNumber(),
      totalCents: Math.round(order.total.toNumber() * 100),
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        notes: item.notes,
        options: item.options.map((option) => ({
          groupName: option.groupName,
          itemName: option.itemName,
          priceDeltaCents: option.priceDeltaCents,
        })),
      })),
    }));
  });

  app.get("/agent/orders/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
      include: {
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    return {
      id: order.id,
      status: order.status,
      createdAt: order.createdAt,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      changeForCents: order.changeForCents,
      paidStatus: order.paidStatus,
      deliveryFeeCents: order.deliveryFeeCents,
      convenienceFeeCents: order.convenienceFeeCents,
      convenienceFeeLabel: order.convenienceFeeLabel,
      notes: order.notes,
      addressLine: order.addressLine,
      addressNumber: order.addressNumber,
      addressNeighborhood: order.addressNeighborhood,
      addressCity: order.addressCity,
      addressReference: order.addressReference,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        notes: item.notes,
        options: item.options.map((option) => ({
          groupName: option.groupName,
          itemName: option.itemName,
          priceDeltaCents: option.priceDeltaCents,
        })),
      })),
      total: order.total.toNumber(),
      totalCents: Math.round(order.total.toNumber() * 100),
    };
  });

  app.patch("/agent/orders/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z.object({
      status: z.enum(["NEW", "PRINTING", "PRINTED"]),
    });

    const { id } = paramsSchema.parse(request.params);
    const { status } = bodySchema.parse(request.body);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updateData: Prisma.OrderUpdateInput = { status };
    if (status === "PRINTING") {
      updateData.printingClaimedAt = order.printingClaimedAt ?? new Date();
    }
    if (status === "NEW") {
      updateData.printingClaimedAt = null;
    }

    const updated = await prisma.order.update({
      where: { id },
      data: updateData,
    });

    sendOrderStreamEvent(agent.storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId: agent.storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.post("/agent/orders/:id/printed", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: "PRINTED" },
    });

    sendOrderStreamEvent(agent.storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId: agent.storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.post("/agent/orders/:id/failed", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const bodySchema = z
      .object({
        reason: z.string().max(500).optional(),
        resetStatus: z.boolean().optional(),
      })
      .optional();
    const { id } = paramsSchema.parse(request.params);
    const { resetStatus } = bodySchema.parse(request.body ?? {}) ?? {};
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const nextStatus = resetStatus ? "NEW" : order.status;
    const updated = await prisma.order.update({
      where: { id },
      data: { status: nextStatus },
    });

    sendOrderStreamEvent(agent.storeId, "order.updated", {
      id: updated.id,
      createdAt: updated.createdAt,
      status: updated.status,
      totalCents: Math.round(updated.total.toNumber() * 100),
      customerName: updated.customerName,
      deliveryType: updated.fulfillmentType,
      storeId: agent.storeId,
    });

    return {
      id: updated.id,
      status: updated.status,
      total: updated.total.toNumber(),
    };
  });

  app.get("/agent/orders/:id/pdf", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const order = await prisma.order.findFirst({
      where: {
        id,
        storeId: agent.storeId,
      },
      include: {
        store: true,
        items: {
          include: {
            product: true,
            options: true,
          },
        },
      },
    });

    if (!order) {
      return reply.status(404).send({ message: "Order not found" });
    }

    const pdf = buildOrderPdf(order);
    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=order-${order.id}.pdf`
    );

    return reply.send(pdf);
  });

  app.get("/agent/print-jobs", async (request, reply) => {
    const querySchema = z.object({
      status: z.string().optional(),
      type: z.nativeEnum(PrintJobType).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    });
    const { status: statusRaw, type, limit } = querySchema.parse(
      request.query
    );
    const statusValue = (statusRaw ?? PrintJobStatus.QUEUED).toUpperCase();

    if (!printJobStatusValues.has(statusValue)) {
      return reply.status(400).send({ message: "Status inválido." });
    }

    if (!Object.values(PrintJobStatus).includes(statusValue as PrintJobStatus)) {
      return [];
    }

    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const printJobs = await prisma.printJob.findMany({
      where: {
        storeId: agent.storeId,
        status: statusValue as PrintJobStatus,
        ...(type ? { type } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    const jobsWithPayload = await Promise.all(
      printJobs.map(async (job) => {
        const payload = await buildAgentPrintJobPayload(prisma, job);
        return {
          id: job.id,
          type: job.type,
          status: job.status,
          storeId: job.storeId,
          tableId: job.tableId,
          tableSessionId: job.tableSessionId,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          payload,
        };
      })
    );

    return jobsWithPayload;
  });

  app.get("/agent/print-jobs/:id", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const printJob = await prisma.printJob.findFirst({
      where: { id, storeId: agent.storeId },
    });

    if (!printJob) {
      return reply.status(404).send({ message: "Impressão não encontrada." });
    }

    const payload = await buildAgentPrintJobPayload(prisma, printJob);

    return {
      id: printJob.id,
      createdAt: printJob.createdAt,
      type: printJob.type,
      status: printJob.status,
      storeId: printJob.storeId,
      payload,
    };
  });

  app.get("/agent/print-jobs/:id/text", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const printJob = await prisma.printJob.findFirst({
      where: { id, storeId: agent.storeId },
      include: { store: true },
    });

    if (!printJob) {
      return reply.status(404).send({ message: "Impressão não encontrada." });
    }

    const payload = await buildAgentPrintJobPayload(prisma, printJob);
    const payloadRecord = isRecord(payload) ? payload : {};
    const items = Array.isArray(payloadRecord.items)
      ? payloadRecord.items.flatMap((item) => {
          if (
            isRecord(item) &&
            typeof item.name === "string" &&
            typeof item.quantity === "number" &&
            typeof item.totalCents === "number"
          ) {
            return [
              {
                name: item.name,
                quantity: item.quantity,
                totalCents: item.totalCents,
              } satisfies TableSummaryItem,
            ];
          }
          return [];
        })
      : [];
    const totalCents =
      typeof payloadRecord.totalCents === "number"
        ? payloadRecord.totalCents
        : null;
    const tableNumber =
      typeof payloadRecord.tableNumber === "number"
        ? payloadRecord.tableNumber
        : null;
    const sessionId =
      typeof payloadRecord.sessionId === "string"
        ? payloadRecord.sessionId
        : null;
    const closedAt =
      typeof payloadRecord.closedAt === "string" ? payloadRecord.closedAt : null;

    const hasPayload =
      items.length > 0 ||
      totalCents !== null ||
      tableNumber !== null ||
      sessionId !== null ||
      closedAt !== null;

    const lines: string[] = [];
    if (!hasPayload) {
      const shortId = printJob.id.split("-")[0];
      lines.push("SMARTPEDIDOS");
      lines.push(`ID: ${shortId}`);
      lines.push(`Data: ${printJob.createdAt.toISOString()}`);
      return { text: lines.join("\n") };
    }

    lines.push("SMARTPEDIDOS");
    if (printJob.store?.name) {
      lines.push(printJob.store.name);
    }
    lines.push("CAIXA - RESUMO");
    if (tableNumber !== null) {
      lines.push(`Mesa ${tableNumber}`);
    }
    if (sessionId) {
      lines.push(`Sessão: ${sessionId}`);
    }
    const closedAtDate = closedAt ? new Date(closedAt) : printJob.createdAt;
    lines.push(`Data: ${closedAtDate.toLocaleString("pt-BR")}`);
    lines.push("-".repeat(42));

    if (items.length === 0) {
      lines.push("Sem itens");
    } else {
      items.forEach((item) => {
        lines.push(...formatItemLines(item));
      });
    }

    if (totalCents !== null) {
      lines.push("-".repeat(42));
      lines.push(formatLine("TOTAL", formatCurrencyCents(totalCents)));
    }

    const shortId = printJob.id.split("-")[0];
    lines.push(`ID: ${shortId}`);

    return { text: lines.join("\n") };
  });

  app.get("/agent/print-jobs/:id/pdf", async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() });
    const { id } = paramsSchema.parse(request.params);
    const agent = (request as typeof request & { agent: { storeId: string } })
      .agent;

    const printJob = await prisma.printJob.findFirst({
      where: { id, storeId: agent.storeId },
      include: { store: true },
    });

    if (!printJob) {
      return reply.status(404).send({ message: "Impressão não encontrada." });
    }

    if (printJob.type !== PrintJobType.CASHIER_TABLE_SUMMARY) {
      return reply.status(400).send({
        message: "Este job não possui resumo de mesa.",
      });
    }

    if (!printJob.tableId) {
      return reply.status(400).send({
        message: "Mesa não informada para este job.",
      });
    }

    const table = await prisma.salonTable.findFirst({
      where: { id: printJob.tableId, storeId: printJob.storeId },
      select: { number: true },
    });

    if (!table) {
      return reply.status(404).send({ message: "Mesa não encontrada." });
    }

    const summary = await buildTableSessionSummary(prisma, {
      storeId: printJob.storeId,
      tableId: printJob.tableId,
      tableSessionId: printJob.tableSessionId,
    });

    const pdf = buildTableSummaryPdf({
      store: printJob.store,
      tableNumber: table.number,
      items: summary.items,
      totalCents: summary.totalCents,
      closedAt: printJob.createdAt,
    });

    reply.header("Content-Type", "application/pdf");
    reply.header(
      "Content-Disposition",
      `inline; filename=table-summary-${printJob.id}.pdf`
    );

    return reply.send(pdf);
  });

  app.post(
    "/agent/print-jobs/:id/printed",
    {
      preHandler: [agentAuth],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
          },
        },
        body: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                printedAt: { type: "string" },
              },
            },
          ],
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = (request.body ?? null) as null | { printedAt?: string };
      const printedAt = body?.printedAt
        ? new Date(body.printedAt)
        : new Date();

      await prisma.printJob.update({
        where: { id },
        data: {
          status: "PRINTED",
          updatedAt: printedAt,
        },
      });

      return reply.code(200).send({ ok: true });
    }
  );

};

const start = async () => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }

  await app.register(fastifyJwt, {
    secret: jwtSecret,
  });
  await app.register(fastifyCookie);
  const allowedOrigins = buildAllowedOrigins();
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(null, allowedOrigins.has(origin));
    },
    credentials: true,
  });

  registerRoutes();
  const recoverIntervalMs = Number(
    process.env.RECOVER_STUCK_ORDERS_INTERVAL_MS ?? 30000
  );
  const runRecoverStuckOrders = async () => {
    try {
      await recoverStuckOrders(prisma, { logger: app.log });
    } catch (error) {
      app.log.error({ err: error }, "recoverStuckOrders: execution failed");
    }
  };
  runRecoverStuckOrders();
  setInterval(runRecoverStuckOrders, recoverIntervalMs);

  app.ready((err) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info("=== ROUTES ===");
    app.log.info("\n" + app.printRoutes());
  });

  const port = Number(process.env.PORT ?? 3000);
  try {
    await app.listen({ port, host: "0.0.0.0" });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
