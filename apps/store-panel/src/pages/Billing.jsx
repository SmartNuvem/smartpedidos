import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatCurrency } from "../api";
import SalesByDayChart from "../components/SalesByDayChart";
import TopProductsList from "../components/TopProductsList";

const formatDateInput = (date) => {
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 10);
};

const todayDateInput = () => formatDateInput(new Date());

const rangeOptions = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "week", label: "7 dias" },
  { value: "month", label: "30 dias" },
  { value: "custom", label: "Personalizado" },
];

const getParamsFromRange = (range, customRange) => {
  if (range === "custom") {
    return {
      period: "custom",
      start: customRange.start,
      end: customRange.end,
    };
  }

  return { period: range };
};

const Billing = () => {
  const [range, setRange] = useState("today");
  const [customRange, setCustomRange] = useState({
    start: todayDateInput(),
    end: todayDateInput(),
  });
  const [summary, setSummary] = useState({
    revenueCents: 0,
    ordersCount: 0,
    averageTicketCents: 0,
  });
  const [seriesByDay, setSeriesByDay] = useState([]);
  const [topProducts, setTopProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const insightsParams = useMemo(() => getParamsFromRange(range, customRange), [range, customRange]);
  const pdfParams = useMemo(() => {
    if (range === "yesterday") {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const date = formatDateInput(yesterday);
      return { range: "custom", start: date, end: date };
    }

    if (range === "week") {
      return { range: "7d" };
    }

    if (range === "month") {
      return { range: "30d" };
    }

    if (range === "custom") {
      return { range: "custom", start: customRange.start, end: customRange.end };
    }

    return { range: "today" };
  }, [customRange.end, customRange.start, range]);

  const loadBillingData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.getBillingInsights(insightsParams);
      setSummary({
        revenueCents: response?.totals?.totalRevenue ?? 0,
        ordersCount: response?.totals?.totalOrders ?? 0,
        averageTicketCents: response?.totals?.avgTicket ?? 0,
      });
      setSeriesByDay(Array.isArray(response?.seriesByDay) ? response.seriesByDay : []);
      setTopProducts(Array.isArray(response?.topProducts) ? response.topProducts : []);
    } catch {
      setError("Não foi possível carregar o faturamento.");
    } finally {
      setLoading(false);
    }
  }, [insightsParams]);

  useEffect(() => {
    if (range !== "custom") {
      loadBillingData();
      return;
    }
    if (customRange.start && customRange.end && customRange.start <= customRange.end) {
      loadBillingData();
    }
  }, [customRange.end, customRange.start, loadBillingData, range]);

  const handlePrintPdf = useCallback(() => {
    const pdfUrl = api.getRevenueReportPdfUrl(pdfParams);
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }, [pdfParams]);

  const hasData = seriesByDay.some((point) => (point.orders ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">Faturamento</h2>
        <p className="mt-1 text-sm text-slate-500">Relatórios completos de faturamento (somente pedidos PRINTED).</p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Período
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {range === "custom" ? (
            <>
              <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                Início
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={customRange.start}
                  onChange={(event) =>
                    setCustomRange((prev) => ({
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
                  value={customRange.end}
                  onChange={(event) =>
                    setCustomRange((prev) => ({
                      ...prev,
                      end: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          ) : null}

          <button
            className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-slate-400"
            type="button"
            onClick={handlePrintPdf}
          >
            Imprimir / PDF
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Faturamento total</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {loading ? "..." : formatCurrency(summary.revenueCents / 100)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Total de pedidos</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {loading ? "..." : summary.ordersCount}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase text-slate-500">Ticket médio</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">
            {loading ? "..." : formatCurrency(summary.averageTicketCents / 100)}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-3">
          <h3 className="text-lg font-semibold text-slate-900">Vendas por dia</h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Carregando gráfico...</p>
          ) : !hasData ? (
            <p className="mt-4 text-sm text-slate-500">Sem pedidos PRINTED no período.</p>
          ) : (
            <div className="mt-4">
              <SalesByDayChart data={seriesByDay} />
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h3 className="text-lg font-semibold text-slate-900">Produtos mais vendidos</h3>
          {loading ? (
            <p className="mt-4 text-sm text-slate-500">Carregando produtos...</p>
          ) : topProducts.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Sem pedidos PRINTED no período.</p>
          ) : (
            <div className="mt-4">
              <TopProductsList data={topProducts} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Billing;
