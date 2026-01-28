import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Button from "../components/Button";
import Select from "../components/Select";
import Table from "../components/Table";
import useNewOrderSound from "../hooks/useNewOrderSound";
import useOrdersStream from "../hooks/useOrdersStream";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "NEW", label: "Novo" },
  { value: "PRINTING", label: "Imprimindo" },
  { value: "PRINTED", label: "Impresso" },
];

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

const Orders = () => {
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newOrderIds, setNewOrderIds] = useState([]);
  const [highlightedIds, setHighlightedIds] = useState(() => new Set());
  const [printingIds, setPrintingIds] = useState(() => new Set());
  const knownOrderIdsRef = useRef(new Set());
  const statusRef = useRef(status);
  const highlightTimersRef = useRef(new Map());
  const { isSupported, isUnlocked, unlock, play } = useNewOrderSound();

  const normalizeOrderPatch = useCallback((payload) => {
    if (!payload?.id) {
      return null;
    }
    return {
      id: payload.id,
      shortId: payload.id.slice(0, 6),
      customerName: payload.customerName,
      status: payload.status,
      fulfillmentType: payload.deliveryType ?? payload.fulfillmentType,
      total:
        typeof payload.total === "number"
          ? payload.total
          : typeof payload.totalCents === "number"
          ? payload.totalCents / 100
          : undefined,
      createdAt: payload.createdAt,
    };
  }, []);

  const mergeOrder = useCallback((existing, patch) => {
    if (!patch) {
      return existing;
    }
    const entries = Object.entries(patch).filter(
      ([, value]) => value !== undefined
    );
    return { ...existing, ...Object.fromEntries(entries) };
  }, []);

  const loadOrders = useCallback(
    async (selectedStatus, { silent = false } = {}) => {
      if (!silent) {
        setLoading(true);
      }
      setError("");
      try {
        const data = await api.getOrders({ status: selectedStatus || undefined });
        setOrders(data);
        knownOrderIdsRef.current = new Set(data.map((order) => order.id));
      } catch {
        setError("Não foi possível carregar os pedidos.");
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    statusRef.current = status;
    loadOrders(status);
  }, [loadOrders, status]);

  useEffect(() => {
    knownOrderIdsRef.current = new Set(orders.map((order) => order.id));
  }, [orders]);

  useEffect(() => {
    return () => {
      highlightTimersRef.current.forEach((timer) => {
        clearTimeout(timer);
      });
      highlightTimersRef.current.clear();
    };
  }, []);

  const matchesStatusFilter = useCallback((orderStatus) => {
    return !statusRef.current || orderStatus === statusRef.current;
  }, []);

  const highlightOrder = useCallback((orderId) => {
    setHighlightedIds((prev) => {
      if (prev.has(orderId)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });
    const existingTimer = highlightTimersRef.current.get(orderId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      setHighlightedIds((prev) => {
        if (!prev.has(orderId)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
      highlightTimersRef.current.delete(orderId);
    }, 10000);
    highlightTimersRef.current.set(orderId, timer);
  }, []);

  const handleOrderCreated = useCallback(
    async (payload) => {
      const orderId = payload?.orderId ?? payload?.id;
      if (!orderId || knownOrderIdsRef.current.has(orderId)) {
        return;
      }
      try {
        const order = await api.getOrder(orderId);
        let didInsert = false;
        setOrders((prev) => {
          if (!matchesStatusFilter(order.status)) {
            return prev;
          }
          if (prev.some((item) => item.id === order.id)) {
            return prev;
          }
          didInsert = true;
          return [order, ...prev];
        });
        if (didInsert) {
          setNewOrderIds((prev) =>
            prev.includes(orderId) ? prev : [...prev, orderId]
          );
          highlightOrder(orderId);
          play();
        }
      } catch {
        // ignore errors fetching new orders
      }
    },
    [highlightOrder, matchesStatusFilter, play]
  );

  const handleOrderUpdated = useCallback(
    async (payload) => {
      const patch = normalizeOrderPatch(payload);
      if (!patch?.id) {
        return;
      }
      if (!knownOrderIdsRef.current.has(patch.id)) {
        if (!matchesStatusFilter(patch.status)) {
          return;
        }
        setOrders((prev) => {
          if (prev.some((item) => item.id === patch.id)) {
            return prev;
          }
          return [patch, ...prev];
        });
        if (patch.status === "NEW") {
          highlightOrder(patch.id);
        }
        return;
      }
      setOrders((prev) => {
        const index = prev.findIndex((item) => item.id === patch.id);
        if (index === -1) {
          return prev;
        }
        const nextOrder = mergeOrder(prev[index], patch);
        if (!matchesStatusFilter(nextOrder.status)) {
          return prev.filter((item) => item.id !== nextOrder.id);
        }
        const updated = [...prev];
        updated[index] = nextOrder;
        return updated;
      });
      if (patch.status === "NEW") {
        highlightOrder(patch.id);
      }
    },
    [highlightOrder, matchesStatusFilter, mergeOrder, normalizeOrderPatch]
  );

  useOrdersStream({
    onOrderCreated: handleOrderCreated,
    onOrderUpdated: handleOrderUpdated,
  });

  const orderHighlights = useMemo(() => highlightedIds, [highlightedIds]);

  const handleMarkPrinting = useCallback(
    async (orderId) => {
      setPrintingIds((prev) => {
        const next = new Set(prev);
        next.add(orderId);
        return next;
      });
      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId ? { ...order, status: "PRINTING" } : order
        )
      );
      try {
        await api.markOrderPrinting(orderId);
      } catch {
        setError("Não foi possível atualizar o status de impressão.");
        setOrders((prev) =>
          prev.map((order) =>
            order.id === orderId ? { ...order, status: "NEW" } : order
          )
        );
      } finally {
        setPrintingIds((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }
    },
    [setOrders]
  );

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">Pedidos</h2>
              {newOrderIds.length > 0 ? (
                <button
                  className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700"
                  onClick={() => setNewOrderIds([])}
                  type="button"
                >
                  Novo pedido ({newOrderIds.length})
                </button>
              ) : null}
            </div>
            <p className="text-sm text-slate-500">
              Acompanhe e gerencie os pedidos da loja.
            </p>
            {!isUnlocked && isSupported ? (
              <button
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-slate-300"
                onClick={unlock}
                type="button"
              >
                Ativar som
              </button>
            ) : null}
          </div>
          <div className="min-w-[180px]">
            <Select
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando pedidos...</p>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : orders.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhum pedido encontrado.
          </p>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Nº
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Cliente
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Total
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Data
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className={`relative hover:bg-slate-50 ${
                    orderHighlights.has(order.id)
                      ? "ring-2 ring-emerald-200 ring-inset"
                      : ""
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    #{order.shortId}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {order.customerName || "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {formatCurrency(order.total)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(
                        order.status
                      )} ${order.status === "NEW" ? "animate-pulse" : ""}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(order.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap items-center justify-end gap-3">
                      {order.status === "NEW" ? (
                        <Button
                          variant="secondary"
                          className="px-3 py-1 text-xs"
                          onClick={() => handleMarkPrinting(order.id)}
                          disabled={printingIds.has(order.id)}
                        >
                          {printingIds.has(order.id)
                            ? "Imprimindo..."
                            : "Imprimir"}
                        </Button>
                      ) : order.status === "PRINTING" ? (
                        <span className="text-xs font-semibold text-amber-600">
                          Imprimindo...
                        </span>
                      ) : order.status === "PRINTED" ? (
                        <span className="text-xs font-semibold text-emerald-600">
                          Impresso
                        </span>
                      ) : null}
                      <Link
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                        to={`/orders/${order.id}`}
                      >
                        Ver detalhes
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
};

export default Orders;
