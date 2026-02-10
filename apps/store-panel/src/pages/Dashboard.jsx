import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatCurrency, formatDateTime } from "../api";
import useNewOrderSound from "../hooks/useNewOrderSound";
import useOrdersStream from "../hooks/useOrdersStream";

const statusBadge = (status) => {
  switch (status) {
    case "NEW":
      return "bg-blue-100 text-blue-700";
    case "PRINTING":
      return "bg-amber-100 text-amber-700";
    case "PRINTED":
      return "bg-emerald-100 text-emerald-700";
    default:
      return "bg-slate-100 text-slate-700";
  }
};


const formatDateInput = (date) => {
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 10);
};

const todayDateInput = () => formatDateInput(new Date());

const rangeOptions = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "15d", label: "15 dias" },
  { value: "30d", label: "30 dias" },
  { value: "custom", label: "Personalizado" },
];

const Dashboard = () => {
  const [store, setStore] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dashboardSummary, setDashboardSummary] = useState({
    newOrders: 0,
    ordersToday: 0,
    revenueTodayCents: 0,
  });
  const [revenueRange, setRevenueRange] = useState("today");
  const [appliedCustomRange, setAppliedCustomRange] = useState({
    start: todayDateInput(),
    end: todayDateInput(),
  });
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [customDraftRange, setCustomDraftRange] = useState({
    start: todayDateInput(),
    end: todayDateInput(),
  });
  const [revenueSummary, setRevenueSummary] = useState({
    rangeLabel: "Hoje",
    ordersCount: 0,
    revenueCents: 0,
    averageTicketCents: 0,
  });
  const [revenueLoading, setRevenueLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const knownOrderIdsRef = useRef(new Set());
  const { isSupported, isUnlocked, unlock, play } = useNewOrderSound();

  const normalizeOrderPatch = useCallback((payload) => {
    if (!payload?.id) {
      return null;
    }
    return {
      id: payload.id,
      shortId: payload.id.slice(0, 6),
      customerName: payload.customerName,
      status: payload.status,
      fulfillmentType: payload.deliveryType ?? payload.fulfillmentType,
      total:
        typeof payload.total === "number"
          ? payload.total
          : typeof payload.totalCents === "number"
          ? payload.totalCents / 100
          : undefined,
      createdAt: payload.createdAt,
    };
  }, []);

  const mergeOrder = useCallback((existing, patch) => {
    if (!patch) {
      return existing;
    }
    const entries = Object.entries(patch).filter(
      ([, value]) => value !== undefined
    );
    return { ...existing, ...Object.fromEntries(entries) };
  }, []);

  useEffect(() => {
    knownOrderIdsRef.current = new Set(orders.map((order) => order.id));
  }, [orders]);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      setError("");
      try {
        const [storeData, ordersData, summaryData, revenueData] = await Promise.all([
          api.getStore(),
          api.getOrders(),
          api.getDashboardSummary(),
          api.getRevenueSummary({ range: "today" }),
        ]);
        if (active) {
          setStore(storeData);
          setOrders(ordersData);
          setDashboardSummary({
            newOrders: summaryData?.newOrders ?? 0,
            ordersToday: summaryData?.ordersToday ?? 0,
            revenueTodayCents: summaryData?.revenueTodayCents ?? 0,
          });
          setRevenueSummary({
            rangeLabel: revenueData?.rangeLabel ?? "Hoje",
            ordersCount: revenueData?.ordersCount ?? 0,
            revenueCents: revenueData?.revenueCents ?? 0,
            averageTicketCents: revenueData?.averageTicketCents ?? 0,
          });
        }
      } catch {
        if (active) {
          setError("Não foi possível carregar os dados do painel.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, []);

  const handleOrderCreated = useCallback(
    async (payload) => {
      const orderId = payload?.orderId ?? payload?.id;
      if (!orderId || knownOrderIdsRef.current.has(orderId)) {
        return;
      }
      try {
        const order = await api.getOrder(orderId);
        setOrders((prev) => {
          if (prev.some((item) => item.id === order.id)) {
            return prev;
          }
          return [order, ...prev];
        });
        play();
      } catch {
        // ignore errors fetching new orders
      }
    },
    [play]
  );

  const handleOrderUpdated = useCallback(
    async (payload) => {
      const patch = normalizeOrderPatch(payload);
      if (!patch?.id) {
        return;
      }
      const shouldFetch = !knownOrderIdsRef.current.has(patch.id);
      if (shouldFetch) {
        try {
          const order = await api.getOrder(patch.id);
          setOrders((prev) => {
            if (prev.some((item) => item.id === order.id)) {
              return prev;
            }
            return [order, ...prev];
          });
        } catch {
          // ignore errors fetching updated orders
        }
        return;
      }
      setOrders((prev) => {
        const index = prev.findIndex((item) => item.id === patch.id);
        if (index === -1) {
          return prev;
        }
        const updated = [...prev];
        updated[index] = mergeOrder(updated[index], patch);
        return updated;
      });
    },
    [mergeOrder, normalizeOrderPatch]
  );

  useOrdersStream({
    onOrderCreated: handleOrderCreated,
    onOrderUpdated: handleOrderUpdated,
  });

  const latestOrders = orders.slice(0, 5);
  const publicBaseUrl =
    import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin;
  const menuUrl = useMemo(() => {
    if (!store?.slug) {
      return "";
    }
    return `${publicBaseUrl}/p/${store.slug}`;
  }, [publicBaseUrl, store?.slug]);

  const handleCopy = useCallback(async () => {
    if (!menuUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(menuUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [menuUrl]);

  const handleOpen = useCallback(() => {
    if (!menuUrl) {
      return;
    }
    window.open(menuUrl, "_blank", "noopener,noreferrer");
  }, [menuUrl]);

  const buildRevenueParams = useCallback(
    (nextRange = revenueRange) => {
      if (nextRange === "custom") {
        return {
          range: "custom",
          start: appliedCustomRange.start,
          end: appliedCustomRange.end,
        };
      }
      return { range: nextRange };
    },
    [appliedCustomRange.end, appliedCustomRange.start, revenueRange]
  );

  const loadRevenueSummary = useCallback(
    async (nextRange = revenueRange) => {
      setRevenueLoading(true);
      try {
        const data = await api.getRevenueSummary(buildRevenueParams(nextRange));
        setRevenueSummary({
          rangeLabel: data?.rangeLabel ?? "Hoje",
          ordersCount: data?.ordersCount ?? 0,
          revenueCents: data?.revenueCents ?? 0,
          averageTicketCents: data?.averageTicketCents ?? 0,
        });
      } catch {
        setError("Não foi possível carregar o faturamento.");
      } finally {
        setRevenueLoading(false);
      }
    },
    [buildRevenueParams, revenueRange]
  );

  const handleRangeChange = useCallback(
    (event) => {
      const nextRange = event.target.value;
      if (nextRange === "custom") {
        setCustomDraftRange(appliedCustomRange);
        setCustomModalOpen(true);
        return;
      }
      setRevenueRange(nextRange);
      loadRevenueSummary(nextRange);
    },
    [appliedCustomRange, loadRevenueSummary]
  );

  const handleApplyCustomRange = useCallback(() => {
    if (!customDraftRange.start || !customDraftRange.end) {
      return;
    }
    if (customDraftRange.start > customDraftRange.end) {
      return;
    }
    setAppliedCustomRange(customDraftRange);
    setRevenueRange("custom");
    setCustomModalOpen(false);
  }, [customDraftRange]);

  useEffect(() => {
    if (revenueRange !== "custom") {
      return;
    }
    loadRevenueSummary("custom");
  }, [appliedCustomRange, loadRevenueSummary, revenueRange]);

  const handleOpenRevenuePdf = useCallback(() => {
    const pdfUrl = api.getRevenueReportPdfUrl(buildRevenueParams());
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }, [buildRevenueParams]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Dashboard
            </h2>
            <p className="text-sm text-slate-500">
              Resumo rápido do painel da loja.
            </p>
            {!isUnlocked && isSupported ? (
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300"
                onClick={unlock}
                type="button"
              >
                Ativar som
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="mt-6 text-sm text-slate-500">Carregando...</p>
        ) : error ? (
          <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Pedidos novos
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {dashboardSummary.newOrders}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Pedidos hoje
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {dashboardSummary.ordersToday}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Faturamento
                  </p>
                  <p className="text-xs text-slate-500">{revenueSummary.rangeLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    value={revenueRange}
                    onChange={handleRangeChange}
                  >
                    {rangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
                    type="button"
                    onClick={handleOpenRevenuePdf}
                  >
                    Imprimir / PDF
                  </button>
                </div>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                💰 {formatCurrency(revenueSummary.revenueCents / 100)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {revenueLoading
                  ? "Atualizando faturamento..."
                  : `${revenueSummary.ordersCount} pedidos · Ticket médio ${formatCurrency(
                      revenueSummary.averageTicketCents / 100
                    )}`}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Loja
              </p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {store?.name}
              </p>
              <p className="text-sm text-slate-500">Slug: {store?.slug}</p>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Link do Cardápio Público
            </h3>
            <p className="text-sm text-slate-500">
              Compartilhe o link do cardápio para seus clientes.
            </p>
          </div>
          {menuUrl ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
              Público
            </span>
          ) : null}
        </div>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-mono text-slate-700">
            {menuUrl || "Carregando link do cardápio..."}
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              type="button"
              onClick={handleCopy}
              disabled={!menuUrl}
            >
              {copied ? "Copiado!" : "Copiar link"}
            </button>
            <button
              className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
              type="button"
              onClick={handleOpen}
              disabled={!menuUrl}
            >
              Abrir
            </button>
          </div>
        </div>
      </div>



      {customModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <h4 className="text-lg font-semibold text-slate-900">
              Período personalizado
            </h4>
            <p className="mt-1 text-sm text-slate-500">
              Escolha a data inicial e final para calcular o faturamento.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Início
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={customDraftRange.start}
                  onChange={(event) =>
                    setCustomDraftRange((prev) => ({
                      ...prev,
                      start: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Fim
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={customDraftRange.end}
                  onChange={(event) =>
                    setCustomDraftRange((prev) => ({
                      ...prev,
                      end: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
            {customDraftRange.start > customDraftRange.end ? (
              <p className="mt-3 text-sm text-rose-600">
                A data inicial não pode ser maior que a final.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
                type="button"
                onClick={() => setCustomModalOpen(false)}
              >
                Cancelar
              </button>
              <button
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                type="button"
                onClick={handleApplyCustomRange}
                disabled={!customDraftRange.start || !customDraftRange.end || customDraftRange.start > customDraftRange.end}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Últimos pedidos
            </h3>
            <p className="text-sm text-slate-500">
              Acompanhe os pedidos mais recentes.
            </p>
          </div>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Carregando pedidos...</p>
        ) : latestOrders.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">
            Nenhum pedido registrado ainda.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {latestOrders.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 px-4 py-3"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    Pedido #{order.shortId}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(order.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(
                      order.status
                    )} ${order.status === "NEW" ? "animate-pulse" : ""}`}
                  >
                    {order.status}
                  </span>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatCurrency(order.total)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
