import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, formatCurrency, formatDateTime } from "../api";
import Button from "../components/Button";
import Table from "../components/Table";

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
    return <p className="text-sm text-slate-500">Carregando pedido...</p>;
  }

  if (!order) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || "Pedido não encontrado."}
        </div>
        <Button variant="secondary" onClick={() => navigate("/orders")}>
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Pedido #{order.shortId}
            </h2>
            <span
              className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadge(
                order.status
              )}`}
            >
              {order.status}
            </span>
          </div>
          <Button onClick={handleReprint} disabled={reprintLoading}>
            {reprintLoading ? "Reimprimindo..." : "Reimprimir"}
          </Button>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Detalhes
            </p>
            <div className="mt-3 space-y-1 text-sm text-slate-700">
              <p>Data: {formatDateTime(order.createdAt)}</p>
              <p>Cliente: {order.customerName || "-"}</p>
              <p>Telefone: {order.customerPhone || "-"}</p>
              <p>
                Tipo:{" "}
                {order.fulfillmentType === "DELIVERY" ? "Entrega" : "Retirar"}
              </p>
              {order.fulfillmentType === "DELIVERY" ? (
                <p>
                  Endereço:{" "}
                  {[
                    order.addressLine,
                    order.addressNumber,
                    order.addressNeighborhood,
                    order.addressCity,
                  ]
                    .filter(Boolean)
                    .join(", ") || "-"}
                </p>
              ) : null}
              {order.addressReference ? (
                <p>Referência: {order.addressReference}</p>
              ) : null}
              <p>Observações: {order.notes || "-"}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Total
            </p>
            <p className="mt-3 text-2xl font-semibold text-slate-900">
              {formatCurrency(order.total)}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Itens</h3>
        <div className="mt-4">
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Produto
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Quantidade
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Preço
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {order.items.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {item.name}
                    {item.notes ? (
                      <p className="mt-1 text-xs font-normal text-slate-500">
                        Obs: {item.notes}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {item.quantity}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {formatCurrency(item.unitPrice)}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-900">
                    {formatCurrency(item.unitPrice * item.quantity)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div className="mt-4">
          <Link
            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            to="/orders"
          >
            &larr; Voltar para pedidos
          </Link>
        </div>
      </div>
    </div>
  );
};

export default OrderDetails;
