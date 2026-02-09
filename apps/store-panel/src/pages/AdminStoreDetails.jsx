import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { adminApi, formatDateTime } from "../api";
import Button from "../components/Button";

const AdminStoreDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [periodChoice, setPeriodChoice] = useState("7");
  const [customDays, setCustomDays] = useState("7");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const resolvedDays =
    periodChoice === "custom" ? Number(customDays) : Number(periodChoice);
  const isCustomDaysValid =
    periodChoice !== "custom" ||
    (Number.isFinite(resolvedDays) && resolvedDays > 0);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Detalhes da loja
          </h2>
          <p className="text-sm text-slate-500">ID: {id}</p>
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
    </div>
  );
};

export default AdminStoreDetails;
