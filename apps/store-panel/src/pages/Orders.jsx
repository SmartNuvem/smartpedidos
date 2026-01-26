import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Select from "../components/Select";
import Table from "../components/Table";

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
  const intervalRef = useRef(null);

  const loadOrders = async (selectedStatus, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError("");
    try {
      const data = await api.getOrders({ status: selectedStatus || undefined });
      setOrders(data);
    } catch {
      setError("Não foi possível carregar os pedidos.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadOrders(status);

    const poll = () => {
      if (document.hidden) {
        return;
      }
      loadOrders(status, { silent: true });
    };

    intervalRef.current = window.setInterval(poll, 5000);

    const handleVisibility = () => {
      if (!document.hidden) {
        loadOrders(status, { silent: true });
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Pedidos</h2>
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
