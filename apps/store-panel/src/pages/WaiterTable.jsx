import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import {
  clearWaiterSession,
  getWaiterSlug,
  getWaiterToken,
} from "../auth";
import Button from "../components/Button";
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

const WaiterTable = () => {
  const { slug, id } = useParams();
  const navigate = useNavigate();
  const [tableData, setTableData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const token = getWaiterToken();

  useEffect(() => {
    const storedSlug = getWaiterSlug();
    if (!token || !slug || storedSlug !== slug) {
      navigate(`/s/${slug}/garcom`, { replace: true });
    }
  }, [navigate, slug, token]);

  const fetchTable = useCallback(async () => {
    if (!id || !token) {
      return;
    }
    setError("");
    try {
      const response = await api.getWaiterSalonTable(id);
      setTableData(response);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar a mesa.");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    fetchTable();
  }, [fetchTable]);

  useSalonStream({
    onTablesUpdated: fetchTable,
    token,
  });

  const table = tableData?.table;
  const orders = tableData?.orders ?? [];

  const dineInLink = useMemo(() => {
    if (!slug || !table?.id) {
      return "#";
    }
    return `/p/${slug}?table=${table.id}`;
  }, [slug, table?.id]);

  const handleLogout = () => {
    clearWaiterSession();
    navigate(`/s/${slug}/garcom`, { replace: true });
  };

  const handleClose = async () => {
    if (!table?.id) {
      return;
    }
    setActionLoading(true);
    setError("");
    try {
      await api.closeWaiterSalonTable(table.id);
      navigate(`/s/${slug}/garcom/mesas`);
    } catch (err) {
      setError(err?.message || "Não foi possível fechar a mesa.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpen = async () => {
    if (!table?.id) {
      return;
    }
    setActionLoading(true);
    setError("");
    try {
      await api.openWaiterSalonTable(table.id);
      await fetchTable();
    } catch (err) {
      setError(err?.message || "Não foi possível abrir a mesa.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <WaiterLayout title="Mesa" subtitle="Carregando...">
        <p className="text-sm text-slate-500">Carregando mesa...</p>
      </WaiterLayout>
    );
  }

  if (!table) {
    return (
      <WaiterLayout title="Mesa" onLogout={handleLogout}>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || "Mesa não encontrada."}
        </div>
      </WaiterLayout>
    );
  }

  return (
    <WaiterLayout
      title={`Mesa ${table.number}`}
      subtitle={`Total acumulado: ${formatCurrency(table.total)}`}
      onLogout={handleLogout}
      actions={
        <Button variant="secondary" onClick={() => navigate(`/s/${slug}/garcom/mesas`)}>
          Voltar
        </Button>
      }
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span
              className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                statusStyles[table.status] || "bg-slate-100 text-slate-600"
              }`}
            >
              {statusLabels[table.status] || table.status}
            </span>
            <p className="mt-2 text-xs text-slate-400">
              Último pedido: {table.lastOrderAt ? formatDateTime(table.lastOrderAt) : "-"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={table.status !== "OPEN"}
              onClick={() => {
                if (table.status === "OPEN" && dineInLink !== "#") {
                  navigate(dineInLink);
                }
              }}
            >
              Adicionar pedido
            </Button>
            {table.status === "OPEN" ? (
              <Button
                variant="danger"
                onClick={handleClose}
                disabled={actionLoading}
              >
                {actionLoading ? "Fechando..." : "Fechar mesa"}
              </Button>
            ) : (
              <Button onClick={handleOpen} disabled={actionLoading}>
                {actionLoading ? "Abrindo..." : "Abrir mesa"}
              </Button>
            )}
          </div>
        </div>
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-900">Pedidos</h3>
          <span className="text-sm text-slate-500">
            {orders.length} pedido(s) nos últimos 7 dias
          </span>
        </div>

        {orders.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Nenhum pedido ainda.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {orders.map((order) => (
              <div
                key={order.id}
                className="rounded-xl border border-slate-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Pedido #{order.shortId}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(order.createdAt)}
                    </p>
                  </div>
                  <div className="text-sm font-semibold text-slate-900">
                    {formatCurrency(order.total)}
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Status: {order.status}
                </div>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-700">
                          {item.quantity}x {item.name}
                        </p>
                        {item.options?.length ? (
                          <div className="mt-1 space-y-1 text-xs text-slate-500">
                            {item.options.map((option) => (
                              <p key={option.id}>
                                {option.groupName}: {option.itemName}
                              </p>
                            ))}
                          </div>
                        ) : null}
                        {item.notes ? (
                          <p className="mt-1 text-xs text-slate-400">
                            Obs: {item.notes}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-sm font-semibold text-slate-700">
                        {formatCurrency(item.unitPrice * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WaiterLayout>
  );
};

export default WaiterTable;
