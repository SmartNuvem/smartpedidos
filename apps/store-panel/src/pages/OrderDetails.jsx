import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";

const OrderDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reprintLoading, setReprintLoading] = useState(false);

  const loadOrder = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getOrder(id);
      setOrder(data);
    } catch {
      setError("Não foi possível carregar o pedido.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrder();
  }, [id]);

  const handleReprint = async () => {
    setReprintLoading(true);
    try {
      await api.reprintOrder(id);
      await loadOrder();
    } catch {
      setError("Não foi possível reenviar para impressão.");
    } finally {
      setReprintLoading(false);
    }
  };

  if (loading) {
    return <p>Carregando pedido...</p>;
  }

  if (!order) {
    return (
      <div>
        <p className="notice">{error || "Pedido não encontrado."}</p>
        <button
          className="secondary"
          onClick={() => navigate("/pedidos")}
          type="button"
        >
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="page-header">
        <div>
          <h1>Pedido #{order.shortId}</h1>
          <p className="muted">Status: {order.status}</p>
        </div>
        <div>
          <button
            onClick={handleReprint}
            disabled={reprintLoading}
            type="button"
          >
            {reprintLoading ? "Reimprimindo..." : "Reimprimir"}
          </button>
        </div>
      </div>

      {error ? <p className="notice">{error}</p> : null}

      <div className="grid-two">
        <div>
          <h3>Detalhes</h3>
          <p>Data: {formatDateTime(order.createdAt)}</p>
          <p>Cliente: {order.customerName || "-"}</p>
          <p>Observações: {order.notes || "-"}</p>
        </div>
        <div>
          <h3>Total</h3>
          <p>{formatCurrency(order.total)}</p>
        </div>
      </div>

      <h3 style={{ marginTop: "1.5rem" }}>Itens</h3>
      <div className="list">
        {order.items.map((item) => (
          <div key={item.id} className="item-row">
            <div>
              <strong>{item.name}</strong>
              <p className="muted">
                {item.qty} x {formatCurrency(item.price)}
              </p>
            </div>
            <div>{formatCurrency(item.price * item.qty)}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <Link to="/pedidos">&larr; Voltar para pedidos</Link>
      </div>
    </div>
  );
};

export default OrderDetails;
