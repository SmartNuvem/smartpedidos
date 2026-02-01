import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { adminApi, formatDateTime } from "../api";
import Button from "../components/Button";

const AdminStoreDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const loadStats = async () => {
      if (!id) {
        setError("Loja inválida.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const data = await adminApi.getStoreWeekStats(id);
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
  }, [id]);

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
              Pedidos últimos 7 dias
            </p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">
              {stats?.ordersLast7Days ?? 0}
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
