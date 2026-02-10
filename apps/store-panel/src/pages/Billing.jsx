import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatCurrency } from "../api";

const formatDateInput = (date) => {
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 10);
};

const todayDateInput = () => formatDateInput(new Date());

const rangeOptions = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "7d", label: "7 dias" },
  { value: "15d", label: "15 dias" },
  { value: "30d", label: "30 dias" },
  { value: "custom", label: "Personalizado" },
];

const getParamsFromRange = (range, customRange) => {
  if (range === "custom") {
    return {
      range: "custom",
      start: customRange.start,
      end: customRange.end,
    };
  }

  if (range === "yesterday") {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = formatDateInput(yesterday);
    return {
      range: "custom",
      start: date,
      end: date,
    };
  }

  return { range };
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
    rangeLabel: "Hoje",
  });
  const [timeseries, setTimeseries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => getParamsFromRange(range, customRange), [range, customRange]);

  const loadRevenueData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [summaryData, timeseriesData] = await Promise.all([
        api.getRevenueSummary(params),
        api.getRevenueTimeseries(params),
      ]);
      setSummary({
        revenueCents: summaryData?.revenueCents ?? 0,
        ordersCount: summaryData?.ordersCount ?? 0,
        averageTicketCents: summaryData?.averageTicketCents ?? 0,
        rangeLabel: summaryData?.rangeLabel ?? "Período",
      });
      setTimeseries(Array.isArray(timeseriesData?.points) ? timeseriesData.points : []);
    } catch {
      setError("Não foi possível carregar o faturamento.");
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    if (range !== "custom") {
      loadRevenueData();
      return;
    }
    if (customRange.start && customRange.end && customRange.start <= customRange.end) {
      loadRevenueData();
    }
  }, [customRange.end, customRange.start, loadRevenueData, range]);

  const maxValue = useMemo(
    () => timeseries.reduce((max, point) => Math.max(max, point.revenueCents ?? 0), 0),
    [timeseries]
  );

  const handlePrintPdf = useCallback(() => {
    const pdfUrl = api.getRevenueReportPdfUrl(params);
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }, [params]);

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
          <p className="mt-1 text-xs text-slate-500">{summary.rangeLabel}</p>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Faturamento por dia</h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Carregando gráfico...</p>
        ) : timeseries.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Sem dados para o período selecionado.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {timeseries.map((point) => {
              const value = point.revenueCents ?? 0;
              const percent = maxValue > 0 ? Math.max((value / maxValue) * 100, 2) : 2;
              return (
                <div key={point.date}>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
                    <span>{point.label}</span>
                    <span>{formatCurrency(value / 100)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100">
                    <div
                      className="h-3 rounded-full bg-blue-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Billing;
