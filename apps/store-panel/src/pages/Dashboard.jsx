import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatCurrency, formatDateTime } from "../api";
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

const Dashboard = () => {
  const [store, setStore] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");
    try {
      const ordersData = await api.getOrders();
      setOrders(ordersData);
    } catch {
      if (!silent) {
        setError("Não foi possível carregar os dados do painel.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setLoading(true);
      setError("");
      try {
        const [storeData, ordersData] = await Promise.all([
          api.getStore(),
          api.getOrders(),
        ]);
        if (active) {
          setStore(storeData);
          setOrders(ordersData);
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

  useOrdersStream({
    onOrderCreated: () => loadOrders({ silent: true }),
    onOrderUpdated: () => loadOrders({ silent: true }),
  });

  const summary = useMemo(() => {
    const today = new Date();
    const todayKey = today.toDateString();
    const newOrders = orders.filter((order) => order.status === "NEW").length;
    const todaysOrders = orders.filter(
      (order) => new Date(order.createdAt).toDateString() === todayKey
    ).length;
    return { newOrders, todaysOrders };
  }, [orders]);

  const latestOrders = orders.slice(0, 5);

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
                {summary.newOrders}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase text-slate-500">
                Pedidos hoje
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {summary.todaysOrders}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 lg:col-span-2">
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
                    )}`}
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
