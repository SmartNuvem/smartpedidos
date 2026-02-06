import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import confetti from "canvas-confetti";
import { API_URL, formatCurrency } from "../api";
import AppFooter from "../components/AppFooter";
import Modal from "../components/Modal";

const initialAddress = {
  line: "",
  reference: "",
};

const getPublicOrderStorageKey = (storeSlug = "") =>
  `smartpedidos:public:form:${storeSlug}`;

const getSafeLocalStorage = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

const readRememberedCustomer = (storeSlug = "") => {
  const storage = getSafeLocalStorage();
  if (!storage || !storeSlug) {
    return null;
  }
  const raw = storage.getItem(getPublicOrderStorageKey(storeSlug));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const formatPhoneBR = (digits = "") => {
  const cleaned = digits.replace(/\D/g, "").slice(0, 11);
  const length = cleaned.length;

  if (length === 0) return "";

  if (length <= 9) {
    if (length <= 4) return cleaned;
    if (length <= 8) return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
    return `${cleaned.slice(0, 5)}-${cleaned.slice(5)}`;
  }

  const ddd = cleaned.slice(0, 2);
  const rest = cleaned.slice(2);

  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
};

const isFlavorGroupName = (name = "") => name.trim().toLowerCase() === "sabores";

const calculatePricingForGroups = ({ pricingRule, basePriceCents, groups }) => {
  if (pricingRule === "SUM") {
    const extrasCents = groups.reduce(
      (acc, group) =>
        acc +
        group.items.reduce(
          (groupTotal, item) => groupTotal + item.priceDeltaCents,
          0
        ),
      0
    );
    return {
      unitPriceCents: basePriceCents + extrasCents,
      baseFromFlavorsCents: null,
      extrasCents,
      hasFlavorSelection: true,
      flavorsCount: 0,
    };
  }

  let baseFromFlavorsCents = null;
  let extrasCents = 0;
  const flavors = [];

  groups.forEach((group) => {
    if (isFlavorGroupName(group.groupName)) {
      group.items.forEach((item) => flavors.push(item.priceDeltaCents));
      return;
    }
    const groupTotal = group.items.reduce(
      (groupSum, item) => groupSum + item.priceDeltaCents,
      0
    );
    extrasCents += groupTotal;
  });

  const flavorsCount = flavors.length;
  const hasFlavorSelection = flavorsCount > 0;

  if (pricingRule === "MAX_OPTION") {
    if (flavorsCount > 0) baseFromFlavorsCents = Math.max(...flavors);
  }

  if (pricingRule === "HALF_SUM") {
    if (flavorsCount === 1) {
      baseFromFlavorsCents = flavors[0];
    } else if (flavorsCount === 2) {
      baseFromFlavorsCents = Math.floor(flavors[0] / 2 + flavors[1] / 2);
    }
  }

  return {
    unitPriceCents: (baseFromFlavorsCents ?? 0) + extrasCents,
    baseFromFlavorsCents,
    extrasCents,
    hasFlavorSelection,
    flavorsCount,
  };
};

const reconcileCartItems = (items, menu) => {
  if (!menu) return items;

  const productMap = new Map();
  menu.categories.forEach((category) => {
    category.products.forEach((product) => {
      productMap.set(product.id, product);
    });
  });

  return items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) return { ...item, unavailable: true };

    const optionGroups = product.optionGroups ?? [];
    const selections = item.optionSelections ?? [];
    const selectionMap = new Map(
      selections.map((selection) => [selection.groupId, selection.itemIds])
    );

    let optionsValid = true;
    const selectedGroups = [];
    const normalizedOptions = [];

    if (optionGroups.length === 0 && selections.length > 0) {
      optionsValid = false;
    }

    optionGroups.forEach((group) => {
      const selectedIds = selectionMap.get(group.id) ?? [];
      const minRequired = group.required
        ? Math.max(group.minSelect ?? 0, 1)
        : group.minSelect ?? 0;
      const maxAllowed =
        group.type === "SINGLE"
          ? 1
          : group.maxSelect > 0
          ? group.maxSelect
          : Number.POSITIVE_INFINITY;

      if (selectedIds.length < minRequired || selectedIds.length > maxAllowed) {
        optionsValid = false;
      }

      if (selectedIds.length === 0) return;

      const itemMap = new Map(group.items.map((option) => [option.id, option]));
      const selectedItems = selectedIds
        .map((optionId) => itemMap.get(optionId))
        .filter(Boolean);

      if (selectedItems.length !== selectedIds.length) {
        optionsValid = false;
        return;
      }

      selectedGroups.push({
        groupName: group.name,
        items: selectedItems.map((option) => ({
          priceDeltaCents: option.priceDeltaCents,
        })),
      });

      normalizedOptions.push({
        groupId: group.id,
        groupName: group.name,
        items: selectedItems.map((option) => ({
          id: option.id,
          name: option.name,
          priceDeltaCents: option.priceDeltaCents,
        })),
      });
    });

    const invalidSelection = selections.some(
      (selection) =>
        !optionGroups.some((group) => group.id === selection.groupId)
    );
    if (invalidSelection) optionsValid = false;

    const missingRequired = optionGroups.some((group) => {
      const minRequired = group.required
        ? Math.max(group.minSelect ?? 0, 1)
        : group.minSelect ?? 0;
      return minRequired > 0 && !selectionMap.has(group.id);
    });
    if (missingRequired) optionsValid = false;

    const resolvedPricingRule = product.pricingRule ?? "SUM";
    const pricingResult = calculatePricingForGroups({
      pricingRule: resolvedPricingRule,
      basePriceCents: product.priceCents,
      groups: selectedGroups,
    });

    if (resolvedPricingRule === "MAX_OPTION" && !pricingResult.hasFlavorSelection) {
      optionsValid = false;
    }
    if (resolvedPricingRule === "HALF_SUM") {
      if (pricingResult.flavorsCount === 0 || pricingResult.flavorsCount > 2) {
        optionsValid = false;
      }
    }

    const updatedItem = {
      ...item,
      name: product.name,
      priceCents: pricingResult.unitPriceCents,
      options: normalizedOptions.length > 0 ? normalizedOptions : item.options ?? [],
    };

    return { ...updatedItem, unavailable: !optionsValid };
  });
};

const PublicOrder = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const tableId = searchParams.get("table");
  const isDineIn = Boolean(tableId);
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

  const [logoLoadError, setLogoLoadError] = useState(false);
  const [bannerLoadError, setBannerLoadError] = useState(false);

  const [rememberCustomerData, setRememberCustomerData] = useState(true);

  const allowPickup = menu?.store?.allowPickup ?? true;
  const allowDelivery = menu?.store?.allowDelivery ?? true;

  useEffect(() => {
    if (!slug) return;
    console.debug("[PublicOrder] store slug", slug);
  }, [slug]);

  useEffect(() => {
    setLogoLoadError(false);
  }, [menu?.store?.logoUrl]);

  useEffect(() => {
    setBannerLoadError(false);
  }, [menu?.store?.bannerUrl]);

  useEffect(() => {
    if (!orderResult) return undefined;

    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
    const t1 = setTimeout(
      () => confetti({ particleCount: 60, spread: 90, origin: { y: 0.6 } }),
      250
    );
    const t2 = setTimeout(
      () => confetti({ particleCount: 40, spread: 110, origin: { y: 0.6 } }),
      500
    );

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [orderResult]);

  const optionGroups = optionProduct?.optionGroups ?? [];

  const promoProducts = useMemo(() => {
    if (!menu) return [];
    const promos = [];
    menu.categories.forEach((category) => {
      category.products.forEach((product) => {
        if (product.isPromo) promos.push({ ...product, categoryName: category.name });
      });
    });
    return promos;
  }, [menu]);

  const sortedCategories = useMemo(() => {
    if (!menu) return [];
    return menu.categories.map((category) => {
      const promoItems = category.products.filter((product) => product.isPromo);
      const regularItems = category.products.filter((product) => !product.isPromo);
      return { ...category, products: [...promoItems, ...regularItems] };
    });
  }, [menu]);

  const fetchMenu = useCallback(
    async ({ showLoading = false } = {}) => {
      if (!slug) return;
      if (showLoading) setLoading(true);
      setError("");
      try {
        const response = await fetch(`${API_URL}/public/${slug}/menu`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error("Menu não encontrado.");
        const data = await response.json();
        setMenu(data);
        setCartItems((prev) => reconcileCartItems(prev, data));
      } catch (err) {
        setError(err.message || "Não foi possível carregar o menu.");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [slug]
  );

  useEffect(() => {
    fetchMenu({ showLoading: true });
  }, [fetchMenu]);

  useEffect(() => {
    if (!slug) return undefined;
    const source = new EventSource(`${API_URL}/public/${slug}/menu/stream`, {
      withCredentials: true,
    });
    const handleMenuUpdate = () => {
      fetchMenu();
    };
    source.addEventListener("menu_updated", handleMenuUpdate);
    return () => {
      source.removeEventListener("menu_updated", handleMenuUpdate);
      source.close();
    };
  }, [fetchMenu, slug]);

  useEffect(() => {
    if (!menu?.nextRefreshAt) return undefined;
    const nextRefreshTime = new Date(menu.nextRefreshAt).getTime();
    if (Number.isNaN(nextRefreshTime)) return undefined;
    const delayMs = nextRefreshTime - Date.now() + 1500;
    if (delayMs <= 0) return undefined;
    const timeoutId = setTimeout(() => {
      fetchMenu();
    }, delayMs);
    return () => clearTimeout(timeoutId);
  }, [fetchMenu, menu?.nextRefreshAt]);

  useEffect(() => {
    if (isDineIn) {
      setPaymentMethod("");
      return;
    }
    if (!menu?.payment) return;
    const availableMethods = [
      menu.payment.acceptPix ? "PIX" : null,
      menu.payment.acceptCash ? "CASH" : null,
      menu.payment.acceptCard ? "CARD" : null,
    ].filter(Boolean);
    if (!availableMethods.includes(paymentMethod)) {
      setPaymentMethod(availableMethods[0] || "");
    }
  }, [menu, paymentMethod, isDineIn]);

  useEffect(() => {
    if (paymentMethod !== "CASH") setChangeFor("");
    if (paymentMethod !== "PIX") setPixCopied(false);
  }, [paymentMethod]);

  useEffect(() => {
    if (!menu) return;
    if (isDineIn) return;
    if (!allowPickup && allowDelivery) setFulfillmentType("DELIVERY");
    else if (!allowDelivery && allowPickup) setFulfillmentType("PICKUP");
    else if (!allowPickup && !allowDelivery) setFulfillmentType("PICKUP");

    if (!allowDelivery) {
      setDeliveryAreaId("");
      setAddress(initialAddress);
    }
  }, [menu, allowPickup, allowDelivery, isDineIn]);

  useEffect(() => {
    if (!slug) return;
    const remembered = readRememberedCustomer(slug);
    if (!remembered) return;

    if (typeof remembered.remember === "boolean") {
      setRememberCustomerData(remembered.remember);
    }
    if (remembered.remember === false) return;

    setCustomerName(remembered.name || "");
    setCustomerPhone(formatPhoneBR(remembered.phone || ""));
    setAddress((prev) => ({ ...prev, line: remembered.addressLine || "" }));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const storage = getSafeLocalStorage();
    if (!storage) return;

    const storageKey = getPublicOrderStorageKey(slug);
    const name = customerName.trim();
    const phone = customerPhone.trim();
    const addressLine = address.line.trim();
    const hasRememberedData = Boolean(name || phone || addressLine);

    if (!rememberCustomerData) {
      storage.setItem(storageKey, JSON.stringify({ remember: false }));
      return;
    }

    if (!hasRememberedData) {
      storage.removeItem(storageKey);
      return;
    }

    storage.setItem(
      storageKey,
      JSON.stringify({ remember: true, name, phone, addressLine })
    );
  }, [slug, rememberCustomerData, customerName, customerPhone, address.line]);

  const createCartItemId = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
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
      isValid: selectedCount >= minRequired && selectedCount <= maxAllowed,
    };
  };

  const buildSelectedGroups = () =>
    optionGroups.map((group) => {
      const selectedIds = getSelectedIds(group.id);
      return {
        groupName: group.name,
        items: group.items
          .filter((item) => selectedIds.includes(item.id))
          .map((item) => ({ priceDeltaCents: item.priceDeltaCents })),
      };
    });

  const calculateOptionPricing = () =>
    calculatePricingForGroups({
      pricingRule: optionProduct?.pricingRule ?? "SUM",
      basePriceCents: optionProduct?.priceCents ?? 0,
      groups: buildSelectedGroups(),
    });

  const handleOptionSelection = (group, itemId) => {
    setOptionError("");
    setOptionSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.type === "SINGLE") return { ...prev, [group.id]: [itemId] };

      const exists = current.includes(itemId);
      if (exists) {
        return { ...prev, [group.id]: current.filter((id) => id !== itemId) };
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
    () => cartItems.reduce((acc, item) => acc + item.quantity * item.priceCents, 0),
    [cartItems]
  );

  const unavailableItems = useMemo(
    () => cartItems.filter((item) => item.unavailable),
    [cartItems]
  );

  const hasUnavailableItems = unavailableItems.length > 0;

  const selectedDeliveryArea = useMemo(() => {
    if (!menu?.deliveryAreas) return null;
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
          index === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
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
    if (!optionProduct) return;

    const allValid = optionGroups.every((group) => getGroupValidation(group).isValid);
    if (!allValid) {
      setOptionError("Selecione as opções obrigatórias para continuar.");
      return;
    }

    const selectedGroups = optionGroups
      .map((group) => {
        const selectedIds = getSelectedIds(group.id);
        if (selectedIds.length === 0) return null;
        const items = group.items.filter((item) => selectedIds.includes(item.id));
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

    const pricingResult = calculatePricingForGroups({
      pricingRule: optionProduct.pricingRule ?? "SUM",
      basePriceCents: optionProduct.priceCents,
      groups: selectedGroups.map((group) => ({
        groupName: group.groupName,
        items: group.items.map((item) => ({ priceDeltaCents: item.priceDeltaCents })),
      })),
    });

    const resolvedPricingRule = optionProduct.pricingRule ?? "SUM";
    if (resolvedPricingRule === "MAX_OPTION" && !pricingResult.hasFlavorSelection) {
      setOptionError("Selecione ao menos 1 sabor.");
      return;
    }
    if (resolvedPricingRule === "HALF_SUM") {
      if (pricingResult.flavorsCount === 0) {
        setOptionError("Selecione ao menos 1 sabor.");
        return;
      }
      if (pricingResult.flavorsCount > 2) {
        setOptionError("Selecione no máximo 2 sabores.");
        return;
      }
    }

    setCartItems((prev) => [
      ...prev,
      {
        id: createCartItemId(),
        productId: optionProduct.id,
        name: optionProduct.name,
        priceCents: pricingResult.unitPriceCents,
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
        .map((item) => (item.id === itemId ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  };

  const handleRemoveItem = (itemId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleRemoveUnavailableItems = () => {
    setCartItems((prev) => prev.filter((item) => !item.unavailable));
  };

  const handleItemNotes = (itemId, value) => {
    setCartItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, notes: value } : item))
    );
  };

  const isDineInOrder = isDineIn;
  const customerPhoneDigits = customerPhone.replace(/\D/g, "").slice(0, 11);
  const isCustomerPhoneValid = isDineInOrder
    ? true
    : [8, 9, 10, 11].includes(customerPhoneDigits.length);

  const isDelivery = !isDineInOrder && fulfillmentType === "DELIVERY" && allowDelivery;
  const deliveryFeeCents =
    isDelivery && selectedDeliveryArea ? selectedDeliveryArea.feeCents : 0;

  const totalCents = subtotalCents + deliveryFeeCents;

  const isStoreOpen = menu?.store?.isOpenNow ?? true;
  const showLogo = Boolean(menu?.store?.logoUrl) && !logoLoadError;

  // Se o banner falhar ao carregar, cai automaticamente para o layout sem banner.
  const showBanner = Boolean(menu?.store?.bannerUrl) && !bannerLoadError;

  const isFulfillmentAllowed = isDineInOrder
    ? true
    : fulfillmentType === "PICKUP"
    ? allowPickup
    : allowDelivery;

  const changeForValue = Number(changeFor.replace(/\./g, "").replace(",", "."));
  const changeForCents =
    Number.isFinite(changeForValue) && changeForValue > 0
      ? Math.round(changeForValue * 100)
      : undefined;

  const requiresChangeForCash =
    !isDineInOrder && paymentMethod === "CASH" && Boolean(menu?.payment?.requireChangeForCash);

  const isChangeAmountValid = changeForCents === undefined || changeForCents >= totalCents;

  const isChangeValid =
    isDineInOrder ||
    paymentMethod !== "CASH" ||
    (requiresChangeForCash
      ? changeForCents !== undefined && isChangeAmountValid
      : isChangeAmountValid);

  const showChangeRequiredError = requiresChangeForCash && changeForCents === undefined;
  const showChangeValueError = !showChangeRequiredError && !isChangeAmountValid;

  const isFormValid =
    cartItems.length > 0 &&
    (isDineInOrder || (customerName.trim().length > 0 && isCustomerPhoneValid)) &&
    (isDineInOrder || paymentMethod) &&
    isStoreOpen &&
    isChangeValid &&
    isFulfillmentAllowed &&
    !hasUnavailableItems &&
    (isDineInOrder || !isDelivery || (deliveryAreaId && address.line.trim()));

  const currentGroup = optionGroups[optionStep];
  const currentGroupValidation = currentGroup ? getGroupValidation(currentGroup) : null;
  const optionPricing = calculateOptionPricing();
  const optionFinalPriceCents = optionPricing.unitPriceCents;

  const scrollToCart = () => {
    cartRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSubmit = async () => {
    if (submitting) return;

    if (!isFormValid) {
      if (!isDineInOrder && !isCustomerPhoneValid) setError("Informe um telefone válido");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const selectedFulfillmentType = isDelivery ? "DELIVERY" : "PICKUP";
      const payload = {
        customerName: customerName.trim() || undefined,
        customerPhone: customerPhone.trim() || undefined,
        customerPhoneDigits: customerPhoneDigits || undefined,
        orderType: isDineInOrder ? "DINE_IN" : selectedFulfillmentType,
        notes: notes.trim() || undefined,
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

      if (!isDineInOrder) {
        payload.paymentMethod = paymentMethod;
        payload.changeForCents = paymentMethod === "CASH" ? changeForCents : undefined;
      }

      if (isDelivery) {
        payload.deliveryAreaId = deliveryAreaId;
        payload.addressLine = address.line.trim();
        payload.addressRef = address.reference.trim() || undefined;
      }

      if (isDineInOrder) {
        payload.tableId = tableId;
      }

      const response = await fetch(`${API_URL}/public/${slug}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || "Não foi possível enviar o pedido.");
      }

      const data = await response.json();

      const resetOrderState = (shouldRememberCustomer) => {
        setCartItems([]);
        setNotes("");
        setDeliveryAreaId("");
        setPaymentMethod("");
        setChangeFor("");
        setFulfillmentType("PICKUP");

        if (shouldRememberCustomer) {
          setAddress((prev) => ({ ...prev, reference: "" }));
          return;
        }

        setCustomerName("");
        setCustomerPhone("");
        setAddress(initialAddress);
      };

      if (isDineInOrder && tableId) {
        resetOrderState(rememberCustomerData);
        setOrderResult(null);
        navigate(`/s/${slug}/garcom/mesas`);
        return;
      }

      setOrderResult(data);
      resetOrderState(rememberCustomerData);
    } catch (err) {
      setError(err.message || "Não foi possível enviar o pedido.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-1 px-4 py-8 text-sm text-slate-500">
          Carregando cardápio...
        </div>
        <AppFooter />
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-1 px-4 py-8">
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error || "Cardápio não encontrado."}
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  if (orderResult) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-6 py-8">
            <h1 className="text-2xl font-semibold text-emerald-700">Pedido enviado!</h1>
            <p className="mt-2 text-sm text-emerald-700">
              Seu pedido foi encaminhado para a loja. Aguarde a confirmação.
            </p>
            <p className="mt-4 text-lg font-semibold text-slate-900">
              Número do pedido: #{orderResult.number}
            </p>

            {orderResult?.paymentMethod === "PIX" && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <div className="font-semibold">Pagamento via Pix</div>
                <div className="mt-1 text-sm">
                  Para agilizar a confirmação, envie o comprovante para o estabelecimento.
                </div>
              </div>
            )}

            <button
              className="mt-6 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700"
              onClick={() => setOrderResult(null)}
            >
              Fazer novo pedido
            </button>
          </div>
        </div>
        <AppFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-6">
        <header className="mb-6">
          {showBanner ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="relative h-48 w-full md:h-56">
                {!bannerLoadError ? (
                  <img
                    src={menu.store.bannerUrl}
                    alt="Banner da loja"
                    className="absolute inset-0 h-full w-full object-cover object-center"
                    onError={() => setBannerLoadError(true)}
                  />
                ) : null}

                <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-end">
                  {showLogo ? (
                    <img
                      src={menu.store.logoUrl}
                      alt="Logo da loja"
                      className="h-12 w-12 rounded-xl bg-white/90 p-1 object-cover shadow sm:h-16 sm:w-16 lg:h-20 lg:w-20"
                      onError={() => setLogoLoadError(true)}
                    />
                  ) : null}

                  <div>
                    <h1 className="inline-flex rounded-xl bg-white/65 px-3 py-2 text-xl font-bold text-gray-900 shadow-sm ring-1 ring-black/5 backdrop-blur-md sm:text-3xl">
                      {menu.store?.name || "Cardápio"}
                    </h1>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${
                          isStoreOpen ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900"
                        }`}
                      >
                        {isStoreOpen ? "Aberto" : "Fechado"}
                      </span>

                      {isDineInOrder ? (
                        <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                          Pedido na mesa
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {showLogo ? (
                <img
                  src={menu.store.logoUrl}
                  alt="Logo da loja"
                  className="h-16 w-16 rounded-xl bg-white object-cover shadow"
                  onError={() => setLogoLoadError(true)}
                />
              ) : null}

              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl font-semibold text-slate-900">
                    {menu.store?.name || "Cardápio"}
                  </h1>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      isStoreOpen ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {isStoreOpen ? "Aberto" : "Fechado"}
                  </span>

                  {isDineInOrder ? (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Pedido na mesa
                    </span>
                  ) : null}
                </div>

                <p className="text-sm text-slate-500">Monte seu pedido e envie direto para a loja.</p>
              </div>
            </div>
          )}

          {!isStoreOpen ? (
            <p className="mt-2 text-sm text-rose-600">
              {menu.store?.closedMessage || "Estamos fechados no momento. Volte mais tarde."}
            </p>
          ) : null}
        </header>

        {/* ... resto do componente permanece igual ao seu ... */}
      </div>

      <AppFooter />
    </div>
  );
};

export default PublicOrder;
