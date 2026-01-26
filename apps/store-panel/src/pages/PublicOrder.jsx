import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { API_URL, formatCurrency } from "../api";
import Modal from "../components/Modal";

const initialAddress = {
  line: "",
  reference: "",
};

const PublicOrder = () => {
  const { slug } = useParams();
  const cartRef = useRef(null);
  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cartItems, setCartItems] = useState([]);
  const [optionModalOpen, setOptionModalOpen] = useState(false);
  const [optionProduct, setOptionProduct] = useState(null);
  const [optionStep, setOptionStep] = useState(0);
  const [optionSelections, setOptionSelections] = useState({});
  const [optionError, setOptionError] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState("PICKUP");
  const [deliveryAreaId, setDeliveryAreaId] = useState("");
  const [address, setAddress] = useState(initialAddress);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [changeFor, setChangeFor] = useState("");
  const [pixCopied, setPixCopied] = useState(false);

  const optionGroups = optionProduct?.optionGroups ?? [];

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

  useEffect(() => {
    if (!menu?.payment) {
      return;
    }
    const availableMethods = [
      menu.payment.acceptPix ? "PIX" : null,
      menu.payment.acceptCash ? "CASH" : null,
      menu.payment.acceptCard ? "CARD" : null,
    ].filter(Boolean);
    if (!availableMethods.includes(paymentMethod)) {
      setPaymentMethod(availableMethods[0] || "");
    }
  }, [menu, paymentMethod]);

  useEffect(() => {
    if (paymentMethod !== "CASH") {
      setChangeFor("");
    }
    if (paymentMethod !== "PIX") {
      setPixCopied(false);
    }
  }, [paymentMethod]);

  const createCartItemId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  const resetOptionModal = () => {
    setOptionModalOpen(false);
    setOptionProduct(null);
    setOptionStep(0);
    setOptionSelections({});
    setOptionError("");
  };

  const openOptionsModal = (product) => {
    setOptionProduct(product);
    setOptionStep(0);
    setOptionSelections({});
    setOptionError("");
    setOptionModalOpen(true);
  };

  const getSelectedIds = (groupId) => optionSelections[groupId] ?? [];

  const getGroupValidation = (group) => {
    const selectedCount = getSelectedIds(group.id).length;
    const minRequired = group.required
      ? Math.max(group.minSelect ?? 0, 1)
      : group.minSelect ?? 0;
    const maxAllowed =
      group.type === "SINGLE"
        ? 1
        : group.maxSelect > 0
          ? group.maxSelect
          : Number.POSITIVE_INFINITY;
    return {
      selectedCount,
      minRequired,
      maxAllowed,
      isValid:
        selectedCount >= minRequired && selectedCount <= maxAllowed,
    };
  };

  const calculateOptionTotalCents = () =>
    optionGroups.reduce((total, group) => {
      const selectedIds = getSelectedIds(group.id);
      const groupTotal = group.items
        .filter((item) => selectedIds.includes(item.id))
        .reduce((acc, item) => acc + item.priceDeltaCents, 0);
      return total + groupTotal;
    }, 0);

  const handleOptionSelection = (group, itemId) => {
    setOptionError("");
    setOptionSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.type === "SINGLE") {
        return { ...prev, [group.id]: [itemId] };
      }
      const exists = current.includes(itemId);
      if (exists) {
        return {
          ...prev,
          [group.id]: current.filter((id) => id !== itemId),
        };
      }
      if (group.maxSelect > 0 && current.length >= group.maxSelect) {
        setOptionError(
          `Selecione no máximo ${group.maxSelect} opção(ões) em ${group.name}.`
        );
        return prev;
      }
      return { ...prev, [group.id]: [...current, itemId] };
    });
  };

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

  const selectedDeliveryArea = useMemo(() => {
    if (!menu?.deliveryAreas) {
      return null;
    }
    return menu.deliveryAreas.find((area) => area.id === deliveryAreaId) || null;
  }, [menu, deliveryAreaId]);

  const handleAddProduct = (product) => {
    if (product.optionGroups && product.optionGroups.length > 0) {
      openOptionsModal(product);
      return;
    }
    setCartItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.productId === product.id && !item.optionSelections?.length
      );
      if (existingIndex >= 0) {
        return prev.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [
        ...prev,
        {
          id: createCartItemId(),
          productId: product.id,
          name: product.name,
          priceCents: product.priceCents,
          quantity: 1,
          notes: "",
          options: [],
          optionSelections: [],
        },
      ];
    });
  };

  const handleConfirmOptions = () => {
    if (!optionProduct) {
      return;
    }
    const allValid = optionGroups.every(
      (group) => getGroupValidation(group).isValid
    );
    if (!allValid) {
      setOptionError("Selecione as opções obrigatórias para continuar.");
      return;
    }

    const selectedGroups = optionGroups
      .map((group) => {
        const selectedIds = getSelectedIds(group.id);
        if (selectedIds.length === 0) {
          return null;
        }
        const items = group.items.filter((item) =>
          selectedIds.includes(item.id)
        );
        return {
          groupId: group.id,
          groupName: group.name,
          items: items.map((item) => ({
            id: item.id,
            name: item.name,
            priceDeltaCents: item.priceDeltaCents,
          })),
        };
      })
      .filter(Boolean);

    const optionSelectionsPayload = selectedGroups.map((group) => ({
      groupId: group.groupId,
      itemIds: group.items.map((item) => item.id),
    }));
    const optionTotalCents = selectedGroups.reduce(
      (sum, group) =>
        sum +
        group.items.reduce(
          (acc, item) => acc + item.priceDeltaCents,
          0
        ),
      0
    );

    setCartItems((prev) => [
      ...prev,
      {
        id: createCartItemId(),
        productId: optionProduct.id,
        name: optionProduct.name,
        priceCents: optionProduct.priceCents + optionTotalCents,
        quantity: 1,
        notes: "",
        options: selectedGroups,
        optionSelections: optionSelectionsPayload,
      },
    ]);

    resetOptionModal();
  };

  const handleQuantityChange = (itemId, delta) => {
    setCartItems((prev) =>
      prev
        .map((item) => {
          if (item.id !== itemId) {
            return item;
          }
          return { ...item, quantity: item.quantity + delta };
        })
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (itemId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleItemNotes = (itemId, value) => {
    setCartItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, notes: value } : item
      )
    );
  };

  const isDelivery = fulfillmentType === "DELIVERY";
  const deliveryFeeCents =
    isDelivery && selectedDeliveryArea ? selectedDeliveryArea.feeCents : 0;
  const totalCents = subtotalCents + deliveryFeeCents;
  const isStoreOpen = menu?.store?.isOpenNow ?? true;
  const changeForValue = Number(
    changeFor.replace(/\./g, "").replace(",", ".")
  );
  const changeForCents =
    Number.isFinite(changeForValue) && changeForValue > 0
      ? Math.round(changeForValue * 100)
      : undefined;
  const isChangeValid =
    paymentMethod !== "CASH" ||
    changeForCents === undefined ||
    changeForCents >= totalCents;
  const isFormValid =
    cartItems.length > 0 &&
    customerName.trim().length > 0 &&
    customerPhone.trim().length > 0 &&
    paymentMethod &&
    isStoreOpen &&
    isChangeValid &&
    (!isDelivery ||
      (deliveryAreaId && address.line.trim()));
  const currentGroup = optionGroups[optionStep];
  const currentGroupValidation = currentGroup
    ? getGroupValidation(currentGroup)
    : null;
  const optionTotalCents = calculateOptionTotalCents();
  const optionFinalPriceCents =
    (optionProduct?.priceCents ?? 0) + optionTotalCents;

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
        orderType: fulfillmentType,
        notes: notes.trim() || undefined,
        paymentMethod,
        changeForCents:
          paymentMethod === "CASH" ? changeForCents : undefined,
        items: cartItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          notes: item.notes.trim() || undefined,
          options:
            item.optionSelections && item.optionSelections.length > 0
              ? item.optionSelections
              : undefined,
        })),
      };
      if (isDelivery) {
        payload.deliveryAreaId = deliveryAreaId;
        payload.addressLine = address.line.trim();
        payload.addressRef = address.reference.trim() || undefined;
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
      setDeliveryAreaId("");
      setPaymentMethod("");
      setChangeFor("");
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
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">
            {menu.store?.name || "Cardápio"}
          </h1>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isStoreOpen
                ? "bg-emerald-100 text-emerald-700"
                : "bg-rose-100 text-rose-700"
            }`}
          >
            {isStoreOpen ? "Aberto" : "Fechado"}
          </span>
        </div>
        <p className="text-sm text-slate-500">
          Monte seu pedido e envie direto para a loja.
        </p>
        {!isStoreOpen ? (
          <p className="mt-2 text-sm text-rose-600">
            {menu.store?.closedMessage ||
              "Estamos fechados no momento. Volte mais tarde."}
          </p>
        ) : null}
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
                        {product.optionGroups && product.optionGroups.length > 0
                          ? "Personalizar"
                          : "Adicionar"}
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
                <div key={item.id} className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        {item.name}
                      </p>
                      <p className="text-sm text-slate-500">
                        {formatCurrency(item.priceCents / 100)}
                      </p>
                      {item.options && item.options.length > 0 ? (
                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                          {item.options.map((group) => (
                            <p key={group.groupId}>
                              <span className="font-semibold">
                                {group.groupName}:
                              </span>{" "}
                              {group.items
                                .map((option) => {
                                  const priceLabel =
                                    option.priceDeltaCents > 0
                                      ? ` (+${formatCurrency(
                                          option.priceDeltaCents / 100
                                        )})`
                                      : "";
                                  return `${option.name}${priceLabel}`;
                                })
                                .join(", ")}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="h-8 w-8 rounded-full border border-slate-200 text-slate-600"
                        onClick={() =>
                          handleQuantityChange(item.id, -1)
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
                          handleQuantityChange(item.id, 1)
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
                      handleItemNotes(item.id, event.target.value)
                    }
                  />
                  <button
                    className="text-xs font-semibold text-rose-500"
                    onClick={() => handleRemoveItem(item.id)}
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
            {isDelivery ? (
              <div className="mt-2 flex items-center justify-between text-slate-700">
                <span>Taxa entrega</span>
                <span className="font-semibold text-slate-900">
                  {formatCurrency(deliveryFeeCents / 100)}
                </span>
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
              <span>Total</span>
              <span>{formatCurrency(totalCents / 100)}</span>
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
                onClick={() => {
                  setFulfillmentType("PICKUP");
                  setDeliveryAreaId("");
                }}
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
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  Bairro
                </label>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  value={deliveryAreaId}
                  onChange={(event) => setDeliveryAreaId(event.target.value)}
                >
                  <option value="">Selecione o bairro</option>
                  {menu.deliveryAreas?.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name} • {formatCurrency(area.feeCents / 100)}
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Rua, número, bloco"
                value={address.line}
                onChange={(event) =>
                  setAddress((prev) => ({ ...prev, line: event.target.value }))
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

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Pagamento</h3>
            <div className="flex flex-wrap gap-2">
              {menu.payment?.acceptPix ? (
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    paymentMethod === "PIX"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                  onClick={() => setPaymentMethod("PIX")}
                >
                  PIX
                </button>
              ) : null}
              {menu.payment?.acceptCash ? (
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    paymentMethod === "CASH"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                  onClick={() => setPaymentMethod("CASH")}
                >
                  Dinheiro
                </button>
              ) : null}
              {menu.payment?.acceptCard ? (
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-semibold ${
                    paymentMethod === "CARD"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600"
                  }`}
                  onClick={() => setPaymentMethod("CARD")}
                >
                  Cartão
                </button>
              ) : null}
            </div>

            {paymentMethod === "CASH" ? (
              <div>
                <label className="text-xs font-semibold uppercase text-slate-500">
                  Troco para quanto?
                </label>
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Ex: 50,00"
                  value={changeFor}
                  onChange={(event) => setChangeFor(event.target.value)}
                />
                {!isChangeValid ? (
                  <p className="mt-1 text-xs text-rose-600">
                    Troco deve ser maior ou igual ao total do pedido.
                  </p>
                ) : null}
              </div>
            ) : null}

            {paymentMethod === "PIX" && menu.payment?.pixKey ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">PIX</p>
                <p>Chave: {menu.payment.pixKey}</p>
                {menu.payment.pixName ? (
                  <p>Nome: {menu.payment.pixName}</p>
                ) : null}
                {menu.payment.pixBank ? (
                  <p>Banco: {menu.payment.pixBank}</p>
                ) : null}
                <button
                  className="mt-2 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        menu.payment.pixKey
                      );
                      setPixCopied(true);
                      setTimeout(() => setPixCopied(false), 2000);
                    } catch {
                      setPixCopied(false);
                    }
                  }}
                >
                  {pixCopied ? "Copiado!" : "Copiar chave"}
                </button>
              </div>
            ) : null}
          </div>

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
            {submitting
              ? "Enviando..."
              : isStoreOpen
                ? "Finalizar pedido"
                : "Loja fechada"}
          </button>
        </aside>
      </div>

      <Modal
        open={optionModalOpen}
        title={optionProduct ? `Personalizar ${optionProduct.name}` : "Personalizar"}
        onClose={resetOptionModal}
        footer={
          optionGroups.length > 0 ? (
            <>
              <button
                className="rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                onClick={() => setOptionStep((prev) => Math.max(prev - 1, 0))}
                disabled={optionStep === 0}
                type="button"
              >
                Voltar
              </button>
              {optionStep < optionGroups.length - 1 ? (
                <button
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300"
                  onClick={() => {
                    if (!currentGroupValidation?.isValid) {
                      setOptionError(
                        "Selecione as opções obrigatórias para continuar."
                      );
                      return;
                    }
                    setOptionStep((prev) =>
                      Math.min(prev + 1, optionGroups.length - 1)
                    );
                  }}
                  type="button"
                  disabled={!currentGroupValidation?.isValid}
                >
                  Próximo
                </button>
              ) : (
                <button
                  className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                  onClick={handleConfirmOptions}
                  type="button"
                >
                  Adicionar ao carrinho
                </button>
              )}
            </>
          ) : null
        }
      >
        {currentGroup ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-700">
                Passo {optionStep + 1} de {optionGroups.length}
              </p>
              <h3 className="text-lg font-semibold text-slate-900">
                {currentGroup.name}
              </h3>
              <p className="text-xs text-slate-500">
                {currentGroup.type === "SINGLE"
                  ? "Escolha uma opção"
                  : "Escolha múltiplas opções"}
                {currentGroup.required
                  ? " • Obrigatório"
                  : currentGroup.minSelect > 0
                    ? ` • Mínimo ${currentGroup.minSelect}`
                    : ""}
                {currentGroup.maxSelect > 0
                  ? ` • Máximo ${currentGroup.maxSelect}`
                  : ""}
              </p>
            </div>

            <div className="space-y-2">
              {currentGroup.items.map((item) => {
                const selectedIds = getSelectedIds(currentGroup.id);
                const isSelected = selectedIds.includes(item.id);
                const isMulti = currentGroup.type === "MULTI";
                const maxReached =
                  isMulti &&
                  currentGroup.maxSelect > 0 &&
                  selectedIds.length >= currentGroup.maxSelect &&
                  !isSelected;
                return (
                  <label
                    key={item.id}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type={isMulti ? "checkbox" : "radio"}
                        name={`group-${currentGroup.id}`}
                        checked={isSelected}
                        disabled={maxReached}
                        onChange={() =>
                          handleOptionSelection(currentGroup, item.id)
                        }
                      />
                      <span className="text-slate-700">{item.name}</span>
                    </div>
                    {item.priceDeltaCents > 0 ? (
                      <span className="text-xs font-semibold text-slate-700">
                        +{formatCurrency(item.priceDeltaCents / 100)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Incluso</span>
                    )}
                  </label>
                );
              })}
            </div>

            {!currentGroupValidation?.isValid ? (
              <p className="text-xs text-rose-600">
                Selecione pelo menos {currentGroupValidation?.minRequired} opção(ões)
                para continuar.
              </p>
            ) : null}

            {optionError ? (
              <p className="text-xs text-rose-600">{optionError}</p>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <p className="text-slate-600">Total do item:</p>
              <p className="font-semibold text-slate-900">
                {formatCurrency(optionFinalPriceCents / 100)}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Nenhuma opção configurada para este produto.
          </p>
        )}
      </Modal>

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
