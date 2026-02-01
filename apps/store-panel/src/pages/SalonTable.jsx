import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Button from "../components/Button";
import useSalonStream from "../hooks/useSalonStream";

const statusStyles = {
  FREE: "bg-emerald-100 text-emerald-700",
  OPEN: "bg-blue-100 text-blue-700",
  CLOSED: "bg-slate-100 text-slate-600",
};

const statusLabels = {
  FREE: "Livre",
  OPEN: "Aberta",
  CLOSED: "Fechada",
};

const SalonTable = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [tableData, setTableData] = useState(null);
  const [store, setStore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const fetchTable = useCallback(async () => {
    if (!id) {
      return;
    }
    setError("");
    try {
      const [tableResponse, storeResponse] = await Promise.all([
        api.getSalonTable(id),
        api.getStore(),
      ]);
      setTableData(tableResponse);
      setStore(storeResponse);
    } catch (err) {
      setError(err?.message || "Não foi possível carregar a mesa.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTable();
  }, [fetchTable]);

  useSalonStream({
    onTablesUpdated: () => {
      fetchTable();
    },
  });

  const table = tableData?.table;
  const orders = tableData?.orders ?? [];

  const dineInLink = useMemo(() => {
    if (!store?.slug || !table?.id) {
      return "#";
    }
    return `/p/${store.slug}?table=${table.id}`;
  }, [store?.slug, table?.id]);

  const handleClose = async () => {
    if (!table?.id) {
      return;
    }
    setActionLoading(true);
    setError("");
    try {
      await api.closeSalonTable(table.id);
      await fetchTable();
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
      await api.openSalonTable(table.id);
      await fetchTable();
    } catch (err) {
      setError(err?.message || "Não foi possível abrir a mesa.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Carregando mesa...</p>;
  }

  if (!table) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error || "Mesa não encontrada."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">
                Mesa {table.number}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  statusStyles[table.status] || "bg-slate-100 text-slate-600"
                }`}
              >
                {statusLabels[table.status] || table.status}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              Total acumulado: {formatCurrency(table.total)}
            </p>
            <p className="text-xs text-slate-400">
              Último pedido: {table.lastOrderAt ? formatDateTime(table.lastOrderAt) : "-"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate("/store/salon")}>Voltar</Button>
            <Button
              disabled={table.status !== "OPEN"}
              title={
                table.status === "OPEN"
                  ? ""
                  : "Abra a mesa para adicionar pedidos."
              }
              onClick={() => {
                if (table.status === "OPEN" && dineInLink !== "#") {
                  window.open(dineInLink, "_blank", "noopener,noreferrer");
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

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
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
                          <p className="text-xs text-slate-400">
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
    </div>
  );
};

export default SalonTable;
