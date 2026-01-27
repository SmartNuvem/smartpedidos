import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Select from "../components/Select";
import Table from "../components/Table";
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
  const knownOrderIdsRef = useRef(new Set());
  const statusRef = useRef(status);
  const audioRef = useRef(null);

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

  const playNotification = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        return;
      }
      const audioContext = audioRef.current ?? new AudioContext();
      audioRef.current = audioContext;
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.2,
        audioContext.currentTime + 0.01
      );
      gainNode.gain.exponentialRampToValueAtTime(
        0.0001,
        audioContext.currentTime + 0.2
      );
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.21);
    } catch {
      // Audio may be blocked by the browser.
    }
  }, []);

  const matchesStatusFilter = useCallback((orderStatus) => {
    return !statusRef.current || orderStatus === statusRef.current;
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
          playNotification();
        }
      } catch {
        // ignore errors fetching new orders
      }
    },
    [matchesStatusFilter, playNotification]
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
    },
    [matchesStatusFilter, mergeOrder, normalizeOrderPatch]
  );

  useOrdersStream({
    onOrderCreated: handleOrderCreated,
    onOrderUpdated: handleOrderUpdated,
  });

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
                <tr key={order.id} className="hover:bg-slate-50">
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
                      )}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatDateTime(order.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                      to={`/orders/${order.id}`}
                    >
                      Ver detalhes
                    </Link>
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
