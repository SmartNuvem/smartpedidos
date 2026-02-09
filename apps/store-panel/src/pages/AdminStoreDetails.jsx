import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { adminApi, formatDateTime } from "../api";
import Button from "../components/Button";

const formatDateInput = (date) => {
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60 * 1000);
  return adjusted.toISOString().slice(0, 10);
};

const subtractDays = (date, days) => {
  const next = new Date(date);
  next.setDate(next.getDate() - days);
  return next;
};

const isValidDateInput = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const AdminStoreDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [store, setStore] = useState(null);
  const [stats, setStats] = useState(null);
  const [periodChoice, setPeriodChoice] = useState("7");
  const [customDays, setCustomDays] = useState("7");
  const [billingPeriodChoice, setBillingPeriodChoice] = useState("7");
  const [billingFrom, setBillingFrom] = useState(
    formatDateInput(subtractDays(new Date(), 6))
  );
  const [billingTo, setBillingTo] = useState(formatDateInput(new Date()));
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const resolvedDays =
    periodChoice === "custom" ? Number(customDays) : Number(periodChoice);
  const isCustomDaysValid =
    periodChoice !== "custom" ||
    (Number.isFinite(resolvedDays) && resolvedDays > 0);
  const today = new Date();
  const resolvedBillingFrom =
    billingPeriodChoice === "custom"
      ? billingFrom
      : formatDateInput(
          subtractDays(today, Math.max(Number(billingPeriodChoice) - 1, 0))
        );
  const resolvedBillingTo =
    billingPeriodChoice === "custom"
      ? billingTo
      : formatDateInput(today);
  const isBillingPeriodValid =
    isValidDateInput(resolvedBillingFrom) &&
    isValidDateInput(resolvedBillingTo) &&
    resolvedBillingFrom <= resolvedBillingTo;

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      if (!id) {
        setError("Loja inválida.");
        setLoading(false);
        return;
      }
      if (!isCustomDaysValid) {
        setError("Informe um período válido.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await adminApi.getStoreStats(id, resolvedDays);
        if (active) {
          setStats(data);
        }
      } catch {
        if (active) {
          setError("Não foi possível carregar as métricas da loja.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadStats();
    return () => {
      active = false;
    };
  }, [id, resolvedDays, isCustomDaysValid]);

  useEffect(() => {
    let active = true;
    const loadStore = async () => {
      if (!id) {
        return;
      }
      try {
        const data = await adminApi.getStore(id);
        if (active) {
          setStore(data);
        }
      } catch {
        if (active) {
          setStore(null);
        }
      }
    };

    loadStore();
    return () => {
      active = false;
    };
  }, [id]);

  const handleBillingPdf = async () => {
    if (!id) {
      setBillingError("Loja inválida.");
      return;
    }
    if (!isBillingPeriodValid) {
      setBillingError("Informe um período válido.");
      return;
    }
    setBillingLoading(true);
    setBillingError("");
    try {
      const blob = await adminApi.getBillingPdf(id, {
        from: resolvedBillingFrom,
        to: resolvedBillingTo,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      link.download = `cobranca-${id}-${resolvedBillingFrom}-a-${resolvedBillingTo}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setBillingError(
        err?.message || "Não foi possível gerar o PDF de cobrança."
      );
    } finally {
      setBillingLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Detalhes da loja
          </h2>
          <p className="text-sm text-slate-500">
            {store?.name ? `${store.name} · ` : ""}ID: {id}
          </p>
        </div>
        <Button variant="secondary" onClick={() => navigate("/admin/stores")}>
          Voltar
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
          Período
          <select
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            value={periodChoice}
            onChange={(event) => {
              setPeriodChoice(event.target.value);
              if (event.target.value !== "custom") {
                setCustomDays(event.target.value);
              }
            }}
          >
            <option value="7">Últimos 7 dias</option>
            <option value="15">Últimos 15 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="custom">Personalizado</option>
          </select>
        </label>
        {periodChoice === "custom" ? (
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Dias
            <input
              type="number"
              min={1}
              className="w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={customDays}
              onChange={(event) => setCustomDays(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Carregando métricas...
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-400">
              Pedidos últimos {resolvedDays} dias
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {stats?.ordersInPeriod ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-400">Pedidos hoje</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {stats?.ordersToday ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-400">Último pedido</p>
            <p className="mt-2 text-base font-semibold text-slate-900">
              {stats?.lastOrderAt
                ? formatDateTime(stats.lastOrderAt)
                : "Sem pedidos"}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Relatório de cobrança
            </h3>
            <p className="text-sm text-slate-500">
              Gere o PDF de cobrança para o período selecionado.
            </p>
          </div>
          {store?.billingModel === "MONTHLY" ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
              Loja no plano mensal
            </span>
          ) : (
            <Button
              onClick={handleBillingPdf}
              disabled={billingLoading || !isBillingPeriodValid}
            >
              {billingLoading ? "Gerando..." : "Gerar PDF de Cobrança"}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
            Período
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={billingPeriodChoice}
              onChange={(event) => {
                setBillingPeriodChoice(event.target.value);
                if (event.target.value !== "custom") {
                  setBillingFrom(
                    formatDateInput(
                      subtractDays(
                        new Date(),
                        Math.max(Number(event.target.value) - 1, 0)
                      )
                    )
                  );
                  setBillingTo(formatDateInput(new Date()));
                }
              }}
            >
              <option value="7">Últimos 7 dias</option>
              <option value="15">Últimos 15 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>

          {billingPeriodChoice === "custom" ? (
            <>
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
                De
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={billingFrom}
                  onChange={(event) => setBillingFrom(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
                Até
                <input
                  type="date"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={billingTo}
                  onChange={(event) => setBillingTo(event.target.value)}
                />
              </label>
            </>
          ) : null}
        </div>

        {billingError ? (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {billingError}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default AdminStoreDetails;
