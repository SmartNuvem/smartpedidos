import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";

const STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "NEW", label: "Novo" },
  { value: "PRINTING", label: "Imprimindo" },
  { value: "PRINTED", label: "Impresso" },
];

const statusClass = (status) => {
  if (status === "NEW") return "badge new";
  if (status === "PRINTING") return "badge printing";
  if (status === "PRINTED") return "badge printed";
  return "badge";
};

const Orders = () => {
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = async (selectedStatus) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getOrders({ status: selectedStatus || undefined });
      setOrders(data);
    } catch {
      setError("Não foi possível carregar os pedidos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders(status);
  }, [status]);

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1>Pedidos</h1>
          <p className="muted">Acompanhe os pedidos da loja.</p>
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Carregando pedidos...</p>
      ) : error ? (
        <p className="notice">{error}</p>
      ) : orders.length === 0 ? (
        <p>Nenhum pedido encontrado.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Nº</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Status</th>
              <th>Data</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>#{order.shortId}</td>
                <td>{order.customerName || "-"}</td>
                <td>{formatCurrency(order.total)}</td>
                <td>
                  <span className={statusClass(order.status)}>
                    {order.status}
                  </span>
                </td>
                <td>{formatDateTime(order.createdAt)}</td>
                <td>
                  <Link to={`/pedidos/${order.id}`}>Ver</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default Orders;
