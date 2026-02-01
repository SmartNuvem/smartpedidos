import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Button from "../components/Button";
import useSalonStream from "../hooks/useSalonStream";

const statusStyles = {
  FREE: "bg-emerald-100 text-emerald-700",
  OPEN: "bg-blue-100 text-blue-700",
};

const statusLabels = {
  FREE: "Livre",
  OPEN: "Aberta",
};

const Salon = () => {
  const navigate = useNavigate();
  const [tables, setTables] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState(null);

  const fetchTables = useCallback(async () => {
    setError("");
    try {
      const settingsData = await api.getSalonSettings();
      setSettings(settingsData);
      if (!settingsData.salonEnabled) {
        setTables([]);
        return;
      }
      const tablesData = await api.getSalonTables();
      setTables(tablesData);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar as mesas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

  useSalonStream({
    onTablesUpdated: () => {
      fetchTables();
    },
  });

  const sortedTables = useMemo(
    () => [...tables].sort((a, b) => a.number - b.number),
    [tables]
  );

  const handleOpen = async (table) => {
    setActionId(table.id);
    try {
      await api.openSalonTable(table.id);
      await fetchTables();
    } catch (err) {
      setError(err?.message || "Não foi possível abrir a mesa.");
    } finally {
      setActionId(null);
    }
  };

  const handleClose = async (table) => {
    setActionId(table.id);
    try {
      await api.closeSalonTable(table.id);
      await fetchTables();
    } catch (err) {
      setError(err?.message || "Não foi possível fechar a mesa.");
    } finally {
      setActionId(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando mesas...</p>;
  }

  if (settings && !settings.salonEnabled) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-900">Salão</h2>
        <p className="mt-2 text-sm text-slate-500">
          O modo salão está desativado para esta loja.
        </p>
        <Button className="mt-4" onClick={() => navigate("/settings")}>
          Ir para configurações
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Salão</h2>
            <p className="text-sm text-slate-500">
              Gerencie as mesas abertas e acompanhe os pedidos em tempo real.
            </p>
          </div>
          <div className="text-sm text-slate-500">
            {settings ? `${settings.salonTableCount} mesas configuradas` : null}
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {sortedTables.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 shadow-sm">
          Nenhuma mesa configurada. Ajuste a quantidade em Configurações.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sortedTables.map((table) => (
            <div
              key={table.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
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
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                <p>
                  Total: <span className="font-semibold text-slate-900">
                    {formatCurrency(table.total)}
                  </span>
                </p>
                <p>
                  Último pedido: {table.lastOrderAt ? formatDateTime(table.lastOrderAt) : "-"}
                </p>
              </div>
              <div className="mt-4 flex gap-2">
                {table.status === "OPEN" ? (
                  <>
                    <Button
                      className="flex-1"
                      onClick={() => navigate(`/store/salon/tables/${table.id}`)}
                    >
                      Ver mesa
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleClose(table)}
                      disabled={actionId === table.id}
                    >
                      {actionId === table.id ? "Fechando..." : "Fechar"}
                    </Button>
                  </>
                ) : (
                  <Button
                    className="flex-1"
                    onClick={() => handleOpen(table)}
                    disabled={actionId === table.id}
                  >
                    Abrir mesa
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Salon;
