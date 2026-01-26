import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { API_URL, formatCurrency } from "../api";

const initialAddress = {
  line: "",
  number: "",
  neighborhood: "",
  city: "",
  reference: "",
};

const PublicOrder = () => {
  const { slug } = useParams();
  const cartRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState("PICKUP");
  const [address, setAddress] = useState(initialAddress);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  useEffect(() => {
    const loadMenu = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${API_URL}/public/${slug}/menu`);
        if (!response.ok) {
          throw new Error("Menu não encontrado.");
        }
        const data = await response.json();
        setMenu(data);
      } catch (err) {
        setError(err.message || "Não foi possível carregar o menu.");
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      loadMenu();
    }
  }, [slug]);

  const totalItems = useMemo(
    () => cartItems.reduce((acc, item) => acc + item.quantity, 0),
    [cartItems]
  );

  const subtotalCents = useMemo(
    () =>
      cartItems.reduce(
        (acc, item) => acc + item.quantity * item.priceCents,
        0
      ),
    [cartItems]
  );

  const handleAddProduct = (product) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          priceCents: product.priceCents,
          quantity: 1,
          notes: "",
        },
      ];
    });
  };

  const handleQuantityChange = (productId, delta) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.productId !== productId) {
            return item;
          }
          return { ...item, quantity: item.quantity + delta };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.productId !== productId));
  };

  const handleItemNotes = (productId, value) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, notes: value } : item
      )
    );
  };

  const isDelivery = fulfillmentType === "DELIVERY";
  const isFormValid =
    cartItems.length > 0 &&
    customerName.trim().length > 0 &&
    customerPhone.trim().length > 0 &&
    (!isDelivery ||
      (address.line.trim() &&
        address.number.trim() &&
        address.neighborhood.trim() &&
        address.city.trim()));

  const scrollToCart = () => {
    cartRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSubmit = async () => {
    if (!isFormValid || submitting) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        fulfillmentType,
        notes: notes.trim() || undefined,
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          notes: item.notes.trim() || undefined,
        })),
      };
      if (isDelivery) {
        payload.address = {
          line: address.line.trim(),
          number: address.number.trim(),
          neighborhood: address.neighborhood.trim(),
          city: address.city.trim(),
          reference: address.reference.trim() || undefined,
        };
      }

      const response = await fetch(`${API_URL}/public/${slug}/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Não foi possível enviar o pedido.");
      }
      const data = await response.json();
      setOrderResult(data);
      setCartItems([]);
      setCustomerName("");
      setCustomerPhone("");
      setNotes("");
      setAddress(initialAddress);
      setFulfillmentType("PICKUP");
    } catch (err) {
      setError(err.message || "Não foi possível enviar o pedido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 text-sm text-slate-500">
        Carregando cardápio...
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error || "Cardápio não encontrado."}
        </div>
      </div>
    );
  }

  if (orderResult) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 py-12 text-center">
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-6 py-8">
          <h1 className="text-2xl font-semibold text-emerald-700">
            Pedido enviado!
          </h1>
          <p className="mt-2 text-sm text-emerald-700">
            Seu pedido foi encaminhado para a loja. Aguarde a confirmação.
          </p>
          <p className="mt-4 text-lg font-semibold text-slate-900">
            Número do pedido: #{orderResult.number}
          </p>
          <button
            className="mt-6 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700"
            onClick={() => setOrderResult(null)}
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">
          {menu.store?.name || "Cardápio"}
        </h1>
        <p className="text-sm text-slate-500">
          Monte seu pedido e envie direto para a loja.
        </p>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="space-y-6">
          {menu.categories.map((category) => (
            <div key={category.id} className="space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">
                {category.name}
              </h2>
              <div className="grid gap-3">
                {category.products.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {product.name}
                        </p>
                        <p className="text-sm text-slate-500">
                          {formatCurrency(product.priceCents / 100)}
                        </p>
                      </div>
                      <button
                        className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                        onClick={() => handleAddProduct(product)}
                      >
                        Adicionar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <aside
          ref={cartRef}
          className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Carrinho</h2>
            <p className="text-sm text-slate-500">
              {totalItems} item(ns) no carrinho
            </p>
          </div>

          {cartItems.length === 0 ? (
            <p className="text-sm text-slate-500">
              Seu carrinho está vazio.
            </p>
          ) : (
            <div className="space-y-4">
              {cartItems.map((item) => (
                <div key={item.productId} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {item.name}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatCurrency(item.priceCents / 100)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="h-8 w-8 rounded-full border border-slate-200 text-slate-600"
                        onClick={() =>
                          handleQuantityChange(item.productId, -1)
                        }
                      >
                        -
                      </button>
                      <span className="w-6 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        className="h-8 w-8 rounded-full border border-slate-200 text-slate-600"
                        onClick={() =>
                          handleQuantityChange(item.productId, 1)
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    rows={2}
                    placeholder="Observações do item (opcional)"
                    value={item.notes}
                    onChange={(event) =>
                      handleItemNotes(item.productId, event.target.value)
                    }
                  />
                  <button
                    className="text-xs font-semibold text-rose-500"
                    onClick={() => handleRemoveItem(item.productId)}
                  >
                    Remover item
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-slate-200 pt-4 text-sm">
            <div className="flex items-center justify-between text-slate-700">
              <span>Subtotal</span>
              <span className="font-semibold text-slate-900">
                {formatCurrency(subtotalCents / 100)}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Seus dados
            </h3>
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Nome completo"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="WhatsApp / Telefone"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Tipo de pedido
            </h3>
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-full border px-3 py-2 text-sm font-semibold ${
                  fulfillmentType === "PICKUP"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
                }`}
                onClick={() => setFulfillmentType("PICKUP")}
              >
                Retirar
              </button>
              <button
                className={`flex-1 rounded-full border px-3 py-2 text-sm font-semibold ${
                  fulfillmentType === "DELIVERY"
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-slate-200 text-slate-600"
                }`}
                onClick={() => setFulfillmentType("DELIVERY")}
              >
                Entrega
              </button>
            </div>
          </div>

          {isDelivery ? (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">Endereço</h3>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Rua / Avenida"
                value={address.line}
                onChange={(event) =>
                  setAddress((prev) => ({ ...prev, line: event.target.value }))
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Número"
                  value={address.number}
                  onChange={(event) =>
                    setAddress((prev) => ({
                      ...prev,
                      number: event.target.value,
                    }))
                  }
                />
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Bairro"
                  value={address.neighborhood}
                  onChange={(event) =>
                    setAddress((prev) => ({
                      ...prev,
                      neighborhood: event.target.value,
                    }))
                  }
                />
              </div>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Cidade"
                value={address.city}
                onChange={(event) =>
                  setAddress((prev) => ({ ...prev, city: event.target.value }))
                }
              />
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Referência (opcional)"
                value={address.reference}
                onChange={(event) =>
                  setAddress((prev) => ({
                    ...prev,
                    reference: event.target.value,
                  }))
                }
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Observações do pedido
            </h3>
            <textarea
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              rows={3}
              placeholder="Algo que devemos saber?"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          <button
            className="w-full rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            onClick={handleSubmit}
            disabled={!isFormValid || submitting}
          >
            {submitting ? "Enviando..." : "Finalizar pedido"}
          </button>
        </aside>
      </div>

      {totalItems > 0 ? (
        <button
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-lg lg:hidden"
          onClick={scrollToCart}
        >
          Ver carrinho ({totalItems})
        </button>
      ) : null}
    </div>
  );
};

export default PublicOrder;
