import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatCurrency } from "../api";
import { clearWaiterSession, getWaiterSlug, getWaiterToken } from "../auth";
import Button from "../components/Button";
import WaiterInstallPrompt from "../components/WaiterInstallPrompt";
import WaiterLayout from "../components/WaiterLayout";
import useSalonStream from "../hooks/useSalonStream";

const statusStyles = {
  FREE: "bg-emerald-100 text-emerald-700",
  OPEN: "bg-blue-100 text-blue-700",
};

const statusLabels = {
  FREE: "Livre",
  OPEN: "Aberta",
};

const WaiterTables = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [tables, setTables] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);

  const token = getWaiterToken();

  useEffect(() => {
    const storedSlug = getWaiterSlug();
    if (!token || !slug || storedSlug !== slug) {
      navigate(`/s/${slug}/garcom`, { replace: true });
    }
  }, [navigate, slug, token]);

  const fetchTables = useCallback(async () => {
    if (!token) {
      return;
    }
    setError("");
    try {
      const settingsData = await api.getWaiterSalonSettings();
      setSettings(settingsData);
      if (!settingsData.salonEnabled) {
        setTables([]);
        return;
      }
      const tablesData = await api.getWaiterSalonTables();
      setTables(tablesData);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar as mesas.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useSalonStream({
    onTablesUpdated: fetchTables,
    token,
  });

  const sortedTables = useMemo(
    () => [...tables].sort((a, b) => a.number - b.number),
    [tables]
  );

  const handleLogout = () => {
    clearWaiterSession();
    navigate(`/s/${slug}/garcom`, { replace: true });
  };

  const handleTableClick = async (table) => {
    if (table.status === "OPEN") {
      navigate(`/s/${slug}/garcom/mesa/${table.id}`);
      return;
    }
    if (table.status !== "FREE") {
      return;
    }
    setActionId(table.id);
    setError("");
    try {
      await api.openWaiterSalonTable(table.id);
      await fetchTables();
    } catch (err) {
      setError(err?.message || "Não foi possível abrir a mesa.");
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return (
      <WaiterLayout title="Mesas" subtitle="Carregando mesas...">
        <p className="text-sm text-slate-500">Carregando...</p>
      </WaiterLayout>
    );
  }

  if (settings && !settings.salonEnabled) {
    return (
      <WaiterLayout
        title="Mesas"
        subtitle="O modo salão está desativado para esta loja."
        onLogout={handleLogout}
      >
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Solicite à gerência para habilitar o salão.
        </div>
      </WaiterLayout>
    );
  }

  return (
    <WaiterLayout
      title="Mesas"
      subtitle={
        settings
          ? `${settings.salonTableCount} mesas configuradas`
          : "Salão em tempo real"
      }
      onLogout={handleLogout}
      actions={
        <Button variant="secondary" onClick={fetchTables}>
          Atualizar
        </Button>
      }
    >
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {sortedTables.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          Nenhuma mesa configurada.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedTables.map((table) => (
            <button
              key={table.id}
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-200"
              onClick={() => handleTableClick(table)}
              disabled={actionId === table.id}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">
                  Mesa {table.number}
                </h3>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    statusStyles[table.status] || "bg-slate-100 text-slate-600"
                  }`}
                >
                  {statusLabels[table.status] || table.status}
                </span>
              </div>
              <div className="mt-4 space-y-1 text-sm text-slate-600">
                <p>
                  Total: {" "}
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(table.total)}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  {table.status === "FREE"
                    ? "Toque para abrir"
                    : "Toque para ver detalhes"}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <WaiterInstallPrompt />
    </WaiterLayout>
  );
};

export default WaiterTables;
