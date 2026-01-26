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
  const [streamStatus, setStreamStatus] = useState("connecting");
  const intervalRef = useRef(null);
  const knownOrderIdsRef = useRef(new Set());
  const statusRef = useRef(status);
  const audioRef = useRef(null);

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

  const handleOrderEvent = useCallback(
    (event, { isCreated }) => {
      try {
        const payload = JSON.parse(event.data);
        if (!payload?.id) {
          return;
        }
        if (isCreated && knownOrderIdsRef.current.has(payload.id)) {
          return;
        }
        if (isCreated) {
          setNewOrderIds((prev) =>
            prev.includes(payload.id) ? prev : [...prev, payload.id]
          );
          playNotification();
        }
        loadOrders(statusRef.current, { silent: true });
      } catch {
        // ignore malformed events
      }
    },
    [loadOrders, playNotification]
  );

  useOrdersStream({
    onOrderCreated: (event) => handleOrderEvent(event, { isCreated: true }),
    onOrderUpdated: (event) => handleOrderEvent(event, { isCreated: false }),
    onConnectionChange: setStreamStatus,
  });

  useEffect(() => {
    const poll = () => {
      if (document.hidden) {
        return;
      }
      loadOrders(statusRef.current, { silent: true });
    };

    const handleVisibility = () => {
      if (!document.hidden) {
        loadOrders(statusRef.current, { silent: true });
      }
    };

    const startPolling = () => {
      if (!intervalRef.current) {
        intervalRef.current = window.setInterval(poll, 5000);
      }
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    if (streamStatus === "open") {
      stopPolling();
    } else {
      startPolling();
    }

    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadOrders, streamStatus]);

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
