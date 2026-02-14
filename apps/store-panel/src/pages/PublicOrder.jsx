import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { API_URL, formatCurrency } from "../api";
import { getOrderCode } from "../utils/orderCode";
import { formatPhoneBR, normalizePhoneDigits } from "../utils/phone";
import AppFooter from "../components/AppFooter";
import Modal from "../components/Modal";
import {
  readPendingPublicOrder,
  removePendingPublicOrder,
  writePendingPublicOrder,
} from "../publicOrderPending";

const initialAddress = {
  line: "",
  reference: "",
};

const getPublicOrderStorageKey = (storeSlug = "") =>
  `smartpedidos:public:form:${storeSlug}`;
const RETRY_INTERVAL_MS = 5000;
const RETRY_WINDOW_MS = 2 * 60 * 1000;
const SEND_RETRY_ERROR_MESSAGE =
  "Sem conexão / erro ao enviar. Vamos reenviar automaticamente.";

const getSafeLocalStorage = () => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch (error) {
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
  } catch (error) {
    return null;
  }
};


const isFlavorGroupName = (name = "") =>
  name.trim().toLowerCase() === "sabores";

const paymentMethodLabels = {
  PIX: "PIX",
  CASH: "Dinheiro",
  CARD: "Cartão",
};

const fulfillmentTypeLabels = {
  DELIVERY: "Entrega",
  PICKUP: "Retirada",
  DINE_IN: "Consumo no local",
};

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
    if (flavorsCount > 0) {
      baseFromFlavorsCents = Math.max(...flavors);
    }
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
  if (!menu) {
    return items;
  }
  const productMap = new Map();
  menu.categories.forEach((category) => {
    category.products.forEach((product) => {
      productMap.set(product.id, product);
    });
  });

  return items.map((item) => {
    const product = productMap.get(item.productId);
    if (!product) {
      return { ...item, unavailable: true };
    }

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

      if (selectedIds.length === 0) {
        return;
      }

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
      (selection) => !optionGroups.some((group) => group.id === selection.groupId)
    );
    if (invalidSelection) {
      optionsValid = false;
    }

    const missingRequired = optionGroups.some((group) => {
      const minRequired = group.required
        ? Math.max(group.minSelect ?? 0, 1)
        : group.minSelect ?? 0;
      return minRequired > 0 && !selectionMap.has(group.id);
    });
    if (missingRequired) {
      optionsValid = false;
    }

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

    return {
      ...updatedItem,
      unavailable: !optionsValid,
    };
  });
};

const isSafariOrIOS = () => {
  if (typeof navigator === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isSafari =
    /Safari/i.test(ua) &&
    !/Chrome|CriOS|Chromium|Edg|OPR|FxiOS|Firefox/i.test(ua);

  return isIOS || isSafari;
};

const openReceiptInNewTab = (url) => {
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    throw new Error("Não foi possível abrir o comprovante. Verifique o bloqueador de pop-ups.");
  }
};

const downloadReceiptFile = async ({ url, fileName, fallbackUrl, fetchErrorMessage }) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(fetchErrorMessage);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  try {
    const link = window.document.createElement("a");
    link.href = blobUrl;
    link.download = fileName;
    link.rel = "noopener noreferrer";
    window.document.body.appendChild(link);

    try {
      link.click();
    } catch (error) {
      openReceiptInNewTab(fallbackUrl);
      return;
    } finally {
      link.remove();
    }

    if (isSafariOrIOS()) {
      openReceiptInNewTab(fallbackUrl);
    }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
  }
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
  const [downloadingReceiptPng, setDownloadingReceiptPng] = useState(false);
  const [receiptPngError, setReceiptPngError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [changeFor, setChangeFor] = useState("");
  const [pixCopied, setPixCopied] = useState(false);
  const [logoLoadError, setLogoLoadError] = useState(false);
  const [bannerLoadError, setBannerLoadError] = useState(false);
  const [pendingOrder, setPendingOrder] = useState(null);
  const [retryingPending, setRetryingPending] = useState(false);

  // 🔥 DETECÇÃO DO BANNER (CLARO/ESCURO)
  const [isBannerLight, setIsBannerLight] = useState(false);

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
    setIsBannerLight(false);
  }, [menu?.store?.bannerUrl]);

  // 🔥 calcula brilho médio do banner pra decidir cor do texto
  const handleBannerLoad = useCallback((event) => {
    try {
      const img = event.currentTarget;
      if (!img?.naturalWidth || !img?.naturalHeight) return;

      const canvas = document.createElement("canvas");
      canvas.width = 50;
      canvas.height = 50;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

      let brightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        brightness += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      }
      const avgBrightness = brightness / (data.length / 4);

      // threshold (ajustável): quanto maior, mais difícil considerar "claro"
      setIsBannerLight(avgBrightness > 180);
    } catch {
      setIsBannerLight(false);
    }
  }, []);

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

  const isMenuV2 = menu?.store?.publicMenuLayout === "V2";

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
    const handleMenuUpdate = () => fetchMenu();
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
    const timeoutId = setTimeout(() => fetchMenu(), delayMs);
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

    if (!allowPickup && allowDelivery) {
      setFulfillmentType("DELIVERY");
    } else if (!allowDelivery && allowPickup) {
      setFulfillmentType("PICKUP");
    } else if (!allowPickup && !allowDelivery) {
      setFulfillmentType("PICKUP");
    }

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
    setCustomerPhone(formatPhoneBR(normalizePhoneDigits(remembered.phone || "")));
    setAddress((prev) => ({ ...prev, line: remembered.addressLine || "" }));
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    const storage = getSafeLocalStorage();
    if (!storage) return;

    const storageKey = getPublicOrderStorageKey(slug);
    const name = customerName.trim();
    const phoneDigits = normalizePhoneDigits(customerPhone);
    const phone = formatPhoneBR(phoneDigits);
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
      JSON.stringify({
        remember: true,
        name,
        phone,
        addressLine,
      })
    );
  }, [slug, rememberCustomerData, customerName, customerPhone, address.line]);

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
      if (group.type === "SINGLE") {
        return { ...prev, [group.id]: [itemId] };
      }
      const exists = current.includes(itemId);
      if (exists) {
        return { ...prev, [group.id]: current.filter((id) => id !== itemId) };
      }
      if (group.maxSelect > 0 && current.length >= group.maxSelect) {
        setOptionError(`Selecione no máximo ${group.maxSelect} opção(ões) em ${group.name}.`);
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

  const unavailableItems = useMemo(() => cartItems.filter((item) => item.unavailable), [cartItems]);
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
        .map((item) => {
          if (item.id !== itemId) return item;
          return { ...item, quantity: item.quantity + delta };
        })
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
    setCartItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, notes: value } : item)));
  };

  const isDineInOrder = isDineIn;
  const customerPhoneDigits = normalizePhoneDigits(customerPhone);
  const isCustomerPhoneValid = isDineInOrder ? true : [8, 9, 10, 11].includes(customerPhoneDigits.length);
  const isDelivery = !isDineInOrder && fulfillmentType === "DELIVERY" && allowDelivery;
  const deliveryFeeCents = isDelivery && selectedDeliveryArea ? selectedDeliveryArea.feeCents : 0;
  const itemsCount = cartItems.reduce((total, item) => total + item.quantity, 0);
  const hasItems = itemsCount > 0;
  const shouldShowConvenienceFee =
    hasItems && menu?.store?.billingModel === "PER_ORDER" && menu?.store?.showFeeOnPublicMenu;
  const baseConvenienceFeeCents = menu?.store?.perOrderFeeCents ?? menu?.store?.convenienceFeeCents ?? 0;
  const convenienceFeeCents = shouldShowConvenienceFee ? baseConvenienceFeeCents : 0;
  const convenienceFeeLabel = menu?.store?.feeLabel || "Taxa de conveniência do app";
  const totalCents = subtotalCents + deliveryFeeCents + convenienceFeeCents;
  const isStoreOpen = menu?.store?.isOpenNow ?? true;
  const menuThemePreset = menu?.store?.themePreset ?? "DEFAULT";
  const menuThemeClass = `theme-${menuThemePreset}`;
  const showLogo = Boolean(menu?.store?.logoUrl) && !logoLoadError;
  const showBanner = Boolean(menu?.store?.bannerUrl) && !bannerLoadError;
  const isFulfillmentAllowed = isDineInOrder ? true : fulfillmentType === "PICKUP" ? allowPickup : allowDelivery;

  const changeForValue = Number(changeFor.replace(/\./g, "").replace(",", "."));
  const changeForCents =
    Number.isFinite(changeForValue) && changeForValue > 0 ? Math.round(changeForValue * 100) : undefined;

  const requiresChangeForCash =
    !isDineInOrder && paymentMethod === "CASH" && Boolean(menu?.payment?.requireChangeForCash);
  const isChangeAmountValid = changeForCents === undefined || changeForCents >= totalCents;
  const isChangeValid =
    isDineInOrder ||
    paymentMethod !== "CASH" ||
    (requiresChangeForCash ? changeForCents !== undefined && isChangeAmountValid : isChangeAmountValid);

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

  const scrollToCategory = (categoryId) => {
    const target = window.document.getElementById(`category-${categoryId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleDownloadReceiptPng = useCallback(
    async (event) => {
      event.stopPropagation();
      if (!orderResult || downloadingReceiptPng) {
        return;
      }

      const receiptToken = orderResult.receiptToken;
      const orderId = orderResult.id || orderResult.orderId;
      if (!receiptToken || !orderId) {
        setReceiptPngError("Comprovante indisponível no momento.");
        return;
      }
      const shortCode = (orderResult.shortCode || orderResult.number || "").toString();
      const fileCode = shortCode ? shortCode.toLowerCase() : getOrderCode(orderId);
      const pngUrl = `${API_URL}/public/orders/${orderId}/receipt.png?token=${encodeURIComponent(receiptToken)}`;

      try {
        setReceiptPngError("");
        setDownloadingReceiptPng(true);
        await downloadReceiptFile({
          url: pngUrl,
          fallbackUrl: pngUrl,
          fileName: `comprovante-${fileCode}.png`,
          fetchErrorMessage: "Não foi possível baixar o comprovante em imagem.",
        });
      } catch (downloadError) {
        setReceiptPngError(
          downloadError.message ||
            "Não foi possível salvar o comprovante em imagem. Tente novamente."
        );
      } finally {
        setDownloadingReceiptPng(false);
      }
    },
    [downloadingReceiptPng, orderResult]
  );

  const resetOrderState = useCallback(
    (shouldRememberCustomer) => {
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
    },
    [setAddress]
  );

  const clearSendRecoveryState = useCallback(() => {
    removePendingPublicOrder();
    setPendingOrder(null);
    setRetryingPending(false);
    setError("");
  }, []);

  const buildReceiptFromContext = useCallback(
    (data, selectedFulfillmentType, receiptContext) => ({
      items: receiptContext.items,
      notes: receiptContext.notes,
      totalCents: receiptContext.totalCents,
      paymentMethod: receiptContext.isDineInOrder ? data.paymentMethod : receiptContext.paymentMethod,
      fulfillmentType: receiptContext.isDineInOrder ? "DINE_IN" : selectedFulfillmentType,
      deliveryAreaName: receiptContext.deliveryAreaName,
      addressLine: receiptContext.addressLine,
      addressReference: receiptContext.addressReference,
    }),
    []
  );

  const sendPublicOrder = useCallback(
    async (payload) => {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${API_URL}/public/${slug}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const error = new Error(data.message || "Não foi possível enviar o pedido.");
          error.retryable = false;
          throw error;
        }

        return response.json();
      } catch (error) {
        if (error.name === "AbortError" || error instanceof TypeError) {
          const retryError = new Error(SEND_RETRY_ERROR_MESSAGE);
          retryError.retryable = true;
          throw retryError;
        }
        throw error;
      } finally {
        window.clearTimeout(timeoutId);
      }
    },
    [slug]
  );

  const handleSubmitSuccess = useCallback(
    (data, selectedFulfillmentType, receiptContext) => {
      clearSendRecoveryState();
      const orderReceipt = buildReceiptFromContext(data, selectedFulfillmentType, receiptContext);

      if (receiptContext.isDineInOrder && tableId) {
        resetOrderState(rememberCustomerData);
        setOrderResult(null);
        navigate(`/s/${slug}/garcom/mesas`);
        return;
      }

      setOrderResult({ ...data, receipt: orderReceipt });
      resetOrderState(rememberCustomerData);
    },
    [
      buildReceiptFromContext,
      clearSendRecoveryState,
      navigate,
      rememberCustomerData,
      resetOrderState,
      slug,
      tableId,
    ]
  );

  const retryPendingOrder = useCallback(
    async ({ manual = false } = {}) => {
      const stored = readPendingPublicOrder();
      if (!stored || stored.storeSlug !== slug || submitting) {
        return;
      }

      const nextPending = {
        ...stored,
        attempts: (stored.attempts ?? 0) + 1,
      };
      writePendingPublicOrder(nextPending);
      setPendingOrder(nextPending);

      if (!manual) {
        setError(SEND_RETRY_ERROR_MESSAGE);
      }

      try {
        setRetryingPending(true);
        const data = await sendPublicOrder(nextPending.payload);
        handleSubmitSuccess(
          data,
          nextPending.selectedFulfillmentType || "PICKUP",
          nextPending.receiptContext
        );
        setPendingOrder(null);
        setError("");
      } catch (err) {
        if (!err.retryable) {
          clearSendRecoveryState();
          setError(err.message || "Não foi possível enviar o pedido.");
          return;
        }
        setError(SEND_RETRY_ERROR_MESSAGE);
      } finally {
        setRetryingPending(false);
      }
    },
    [clearSendRecoveryState, handleSubmitSuccess, sendPublicOrder, slug, submitting]
  );

  useEffect(() => {
    const stored = readPendingPublicOrder();
    if (!stored || stored.storeSlug !== slug) {
      return;
    }
    setPendingOrder(stored);
    setError(SEND_RETRY_ERROR_MESSAGE);
    retryPendingOrder();
  }, [retryPendingOrder, slug]);

  useEffect(() => {
    if (!pendingOrder || pendingOrder.storeSlug !== slug || orderResult) {
      return undefined;
    }

    const onOnline = () => retryPendingOrder();
    window.addEventListener("online", onOnline);

    const elapsedMs = Date.now() - pendingOrder.createdAt;
    if (elapsedMs >= RETRY_WINDOW_MS) {
      return () => window.removeEventListener("online", onOnline);
    }

    const intervalId = window.setInterval(() => {
      retryPendingOrder();
    }, RETRY_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(intervalId);
    };
  }, [orderResult, pendingOrder, retryPendingOrder, slug]);

  const handleSubmit = async () => {
    if (submitting || retryingPending) return;
    if (!isFormValid) {
      if (!isDineInOrder && !isCustomerPhoneValid) setError("Informe um telefone válido");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const selectedFulfillmentType = isDelivery ? "DELIVERY" : "PICKUP";
      const clientOrderId = crypto.randomUUID();
      const payload = {
        clientOrderId,
        customerName: customerName.trim() || undefined,
        customerPhone: (customerPhoneDigits ? formatPhoneBR(customerPhoneDigits) : "") || undefined,
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

      const pendingPayload = {
        storeSlug: slug,
        clientOrderId,
        payload,
        createdAt: Date.now(),
        attempts: 0,
        selectedFulfillmentType,
        receiptContext: {
          items: cartItems,
          notes: notes.trim() || "",
          totalCents,
          paymentMethod,
          isDineInOrder,
          deliveryAreaName: selectedDeliveryArea?.name || "",
          addressLine: isDelivery ? address.line.trim() : "",
          addressReference: isDelivery ? address.reference.trim() : "",
        },
      };

      writePendingPublicOrder(pendingPayload);
      setPendingOrder(pendingPayload);

      const data = await sendPublicOrder(payload);
      handleSubmitSuccess(data, selectedFulfillmentType, pendingPayload.receiptContext);
      setPendingOrder(null);
    } catch (err) {
      if (!err.retryable) {
        clearSendRecoveryState();
        setError(err.message || "Não foi possível enviar o pedido.");
      } else {
        setError(SEND_RETRY_ERROR_MESSAGE);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const hasActiveSendRetryError = Boolean(pendingOrder) && error === SEND_RETRY_ERROR_MESSAGE;

  if (loading) {
    return (
      <div className={`public-menu-root ${menuThemeClass} flex min-h-screen flex-col`}>
        <div className="mx-auto flex w-full max-w-3xl flex-1 px-4 py-8 text-sm text-slate-500">
          Carregando cardápio...
        </div>
        <AppFooter />
      </div>
    );
  }

  if (!menu) {
    return (
      <div className={`public-menu-root ${menuThemeClass} flex min-h-screen flex-col`}>
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
    const receipt = orderResult.receipt;
    const paymentLabel = paymentMethodLabels[receipt?.paymentMethod] || "Não informado";
    const fulfillmentLabel =
      fulfillmentTypeLabels[receipt?.fulfillmentType] || fulfillmentTypeLabels.PICKUP;
    const hasAddress = Boolean(receipt?.addressLine || receipt?.deliveryAreaName);

    const receiptToken = orderResult?.receiptToken;
    const orderId = orderResult?.id || orderResult?.orderId;
    const orderDisplayNumber =
      (orderResult?.shortCode || orderResult?.number || "").toString().toLowerCase() ||
      getOrderCode(orderId);
    const storeName = receipt?.storeName || menu.store?.name || "Loja";

    return (
      <div className={`public-menu-root ${menuThemeClass} flex min-h-screen flex-col`}>
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden="true" />
        <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <div className="relative z-10 w-full rounded-2xl border border-slate-200 bg-white px-4 py-6 sm:px-6 sm:py-8">
            <span
              className="inline-flex rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
              style={{
                borderColor: "var(--primary, #16a34a)",
                color: "var(--primary, #16a34a)",
              }}
            >
              Pedido confirmado
            </span>
            <h1 className="mt-3 text-2xl font-semibold" style={{ color: "var(--text, #0f172a)" }}>
              Pedido enviado!
            </h1>
            <p className="mt-2 text-sm" style={{ color: "var(--muted, #64748b)" }}>
              Seu pedido foi encaminhado para a loja. Aguarde a confirmação.
            </p>
            <p className="mt-4 text-lg font-semibold text-slate-900">
              Número do pedido: #{orderDisplayNumber}
            </p>

            <div
              className="mx-auto mt-6 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm sm:p-5"
            >
              <h2 className="text-base font-semibold text-slate-900">Comprovante do pedido</h2>
              <p className="mt-1 text-sm font-medium text-slate-700">{storeName}</p>
              <p className="mt-1 text-xs text-slate-500">Pedido #{orderDisplayNumber}</p>

              <div className="mt-4 space-y-3">
                {receipt?.items?.map((item) => (
                  <div key={item.id} className="border-b border-dashed border-slate-200 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium text-slate-800">
                        {item.quantity}x {item.name}
                      </p>
                    </div>
                    {item.options?.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {item.options.map((group) => (
                          <p key={group.groupId} className="text-xs text-slate-600">
                            {group.groupName}: {group.items.map((option) => option.name).join(", ")}
                          </p>
                        ))}
                      </div>
                    )}
                    {item.notes ? <p className="mt-1 text-xs text-slate-500">Obs. item: {item.notes}</p> : null}
                  </div>
                ))}
              </div>

              {receipt?.notes ? (
                <p className="mt-3 text-sm text-slate-700">
                  <span className="font-medium">Observações:</span> {receipt.notes}
                </p>
              ) : null}

              <div className="mt-4 space-y-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                <p>
                  <span className="font-medium">Pagamento:</span> {paymentLabel}
                </p>
                <p>
                  <span className="font-medium">Tipo:</span> {fulfillmentLabel}
                </p>
                {hasAddress && (
                  <p>
                    <span className="font-medium">Endereço:</span>{" "}
                    {[receipt.deliveryAreaName, receipt.addressLine, receipt.addressReference]
                      .filter(Boolean)
                      .join(" • ")}
                  </p>
                )}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-dashed border-slate-300 pt-3">
                <span className="text-sm text-slate-600">Total</span>
                <strong className="text-base text-slate-900">
                  {formatCurrency((receipt?.totalCents ?? 0) / 100)}
                </strong>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              {receiptToken && orderId ? (
                <button
                  type="button"
                  onClick={handleDownloadReceiptPng}
                  disabled={downloadingReceiptPng}
                  className="rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {downloadingReceiptPng
                    ? "Baixando comprovante (imagem)..."
                    : "Salvar comprovante (imagem)"}
                </button>
              ) : null}
            </div>

            {receiptPngError ? (
              <p className="mt-3 text-sm font-medium text-rose-700">{receiptPngError}</p>
            ) : null}

            {orderResult?.paymentMethod === "PIX" && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-left">
                <div className="font-semibold" style={{ color: "var(--primary, #16a34a)" }}>
                  Pagamento via Pix
                </div>
                <div className="mt-1 text-sm" style={{ color: "var(--muted, #64748b)" }}>
                  Para agilizar a confirmação, envie o comprovante para o estabelecimento.
                </div>
              </div>
            )}
            <button
              type="button"
              className="mt-6 rounded-full border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700"
              onClick={() => {
                clearSendRecoveryState();
                setOrderResult(null);
              }}
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
    <div className={`public-menu-root ${menuThemeClass} flex min-h-screen flex-col`}>
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-6">
        <header className="mb-6">
  {/* HERO */}
  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {/* Banner (se existir) */}
    {showBanner ? (
      <div className="relative h-44 w-full sm:h-52">
        <img
          src={menu.store.bannerUrl}
          alt="Banner da loja"
          className="absolute inset-0 h-full w-full object-cover object-center"
          onLoad={handleBannerLoad}
          onError={() => setBannerLoadError(true)}
        />

        {/* Overlay pra sempre ficar legível */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />

        {/* Conteúdo */}
        <div className="relative flex h-full items-end p-4">
          <div className="flex items-end gap-3">
            {showLogo ? (
              <div className="h-14 w-14 overflow-hidden rounded-2xl bg-white shadow ring-1 ring-black/10 sm:h-16 sm:w-16">
                <img
                  src={menu.store.logoUrl}
                  alt="Logo da loja"
                  className="h-full w-full object-contain p-2"
                  onError={() => setLogoLoadError(true)}
                />
              </div>
            ) : null}

            <div className="pb-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-extrabold text-white sm:text-3xl">
                  {menu.store?.name || "Cardápio"}
                </h1>

                <span
                  className={`relative top-[2px] rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${
                    isStoreOpen
                      ? "bg-emerald-200/90 text-emerald-950"
                      : "bg-rose-200/90 text-rose-950"
                  }`}
                >
                  {isStoreOpen ? "Aberto" : "Fechado"}
                </span>

                {isDineInOrder ? (
                  <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/20">
                    Pedido na mesa
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : (
      /* Sem banner: header compacto e bonito */
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          {showLogo ? (
            <div className="h-14 w-14 overflow-hidden rounded-2xl bg-white shadow ring-1 ring-black/10 sm:h-16 sm:w-16">
              <img
                src={menu.store.logoUrl}
                alt="Logo da loja"
                className="h-full w-full object-contain p-2"
                onError={() => setLogoLoadError(true)}
              />
            </div>
          ) : null}

          <div>
            <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">
              {menu.store?.name || "Cardápio"}
            </h1>
            <p className="text-sm text-slate-500">
              Monte seu pedido e envie direto para a loja.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              isStoreOpen
                ? "bg-emerald-100 text-emerald-800"
                : "bg-rose-100 text-rose-800"
            }`}
          >
            {isStoreOpen ? "Aberto" : "Fechado"}
          </span>

          {isDineInOrder ? (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              Pedido na mesa
            </span>
          ) : null}
        </div>
      </div>
    )}
  </div>

  {/* Mensagem de fechado */}
  {!isStoreOpen ? (
    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {menu.store?.closedMessage || "Estamos fechados no momento. Volte mais tarde."}
    </div>
  ) : null}
</header>


        {error && (error !== SEND_RETRY_ERROR_MESSAGE || hasActiveSendRetryError) ? (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {pendingOrder ? (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p>
              Pedido pendente de envio. Tentativas: <strong>{pendingOrder.attempts ?? 0}</strong>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => retryPendingOrder({ manual: true })}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                disabled={retryingPending}
              >
                {retryingPending ? "Enviando..." : "Tentar agora"}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSendRecoveryState();
                }}
                className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
              >
                Cancelar pedido pendente
              </button>
            </div>
          </div>
        ) : null}

        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="space-y-6">
            {isMenuV2 ? (
              <div className="sticky top-2 z-20 -mx-2 overflow-x-auto rounded-xl bg-white/95 px-2 py-2 shadow-sm backdrop-blur">
                <div className="flex w-max gap-2">
                  {sortedCategories.map((category) => (
                    <button
                      key={`tab-${category.id}`}
                      type="button"
                      className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                      onClick={() => scrollToCategory(category.id)}
                    >
                      {category.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {!isMenuV2 && promoProducts.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-slate-900">Promoção do dia</h2>
                  <span className="text-xs font-semibold uppercase text-rose-500">
                    Ofertas especiais
                  </span>
                </div>
                <div className="grid gap-3">
                  {promoProducts.map((product) => (
                    <div
                      key={`promo-${product.id}`}
                      className="rounded-2xl border border-rose-200 bg-rose-50/40 p-4 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-900">{product.name}</p>
                            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-700">
                              {product.categoryName}
                            </span>
                            <span className="animate-pulse rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                              Promoção do dia
                            </span>
                          </div>
                          {product.composition?.trim() ? (
                            <p className="line-clamp-2 text-xs text-slate-500">{product.composition}</p>
                          ) : null}
                          <p className="text-sm text-slate-500">
                            {formatCurrency(product.priceCents / 100)}
                          </p>
                        </div>
                        <button
                          className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
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
            ) : null}

            {sortedCategories.map((category) => (
              <div id={`category-${category.id}`} key={category.id} className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-900">{category.name}</h2>
                <div className="grid gap-3">
                  {category.products.map((product) => (
                    <div
                      key={product.id}
                      className={
                        isMenuV2
                          ? "overflow-hidden rounded-xl bg-white shadow-sm"
                          : "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                      }
                    >
                      <div className="flex items-stretch justify-between gap-4">
                        {isMenuV2 ? (
                          <div className="h-28 w-28 flex-shrink-0 sm:h-32 sm:w-32">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gray-100 text-xs text-gray-400">
                                Sem foto
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div
                          className={
                            isMenuV2
                              ? "flex flex-1 flex-col justify-between p-4"
                              : "flex flex-1 items-center gap-3"
                          }
                        >
                          {!isMenuV2 && product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              loading="lazy"
                              className="h-16 w-16 rounded-xl object-cover"
                            />
                          ) : null}
                          {!isMenuV2 && !product.imageUrl ? (
                            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-[10px] text-slate-500">
                              Sem foto
                            </div>
                          ) : null}
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-semibold text-slate-900">{product.name}</p>
                              {product.isPromo ? (
                                <span className="animate-pulse rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                                  Promoção do dia
                                </span>
                              ) : null}
                              {isMenuV2 && product.isFeatured ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">Mais pedido</span> : null}
                              {isMenuV2 && product.isNew ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">Novo</span> : null}
                              {isMenuV2 && product.isOnSale ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold">Oferta</span> : null}
                            </div>
                            {product.composition?.trim() ? (
                              <p className="line-clamp-2 text-xs text-slate-500">{product.composition}</p>
                            ) : null}
                            <p className="text-sm text-slate-500">
                              {formatCurrency(product.priceCents / 100)}
                            </p>
                          </div>
                          {isMenuV2 ? (
                            <div className="mt-3 flex justify-end">
                              <button
                                className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                                onClick={() => handleAddProduct(product)}
                              >
                                {product.optionGroups && product.optionGroups.length > 0
                                  ? "Personalizar"
                                  : "Adicionar"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                        {!isMenuV2 ? (
                          <button
                            className="shrink-0 self-center rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
                            onClick={() => handleAddProduct(product)}
                          >
                            {product.optionGroups && product.optionGroups.length > 0
                              ? "Personalizar"
                              : "Adicionar"}
                          </button>
                        ) : null}
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
              <p className="text-sm text-slate-500">{totalItems} item(ns) no carrinho</p>
            </div>

            {hasUnavailableItems ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <p className="font-semibold">
                  Alguns itens ficaram indisponíveis. Remova para continuar.
                </p>
                <button
                  className="mt-2 rounded-full border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700"
                  onClick={handleRemoveUnavailableItems}
                >
                  Remover itens indisponíveis
                </button>
              </div>
            ) : null}

            {cartItems.length === 0 ? (
              <p className="text-sm text-slate-500">Seu carrinho está vazio.</p>
            ) : (
              <div className="space-y-4">
                {cartItems.map((item) => (
                  <div key={item.id} className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          {item.unavailable ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700">
                              Indisponível
                            </span>
                          ) : null}
                        </div>
                        <p className="text-sm text-slate-500">
                          {formatCurrency(item.priceCents / 100)}
                        </p>

                        {item.options && item.options.length > 0 ? (
                          <div className="mt-2 space-y-1 text-xs text-slate-500">
                            {item.options.map((group) => (
                              <p key={group.groupId}>
                                <span className="font-semibold">{group.groupName}:</span>{" "}
                                {group.items
                                  .map((option) => {
                                    const priceLabel =
                                      option.priceDeltaCents > 0
                                        ? ` (+${formatCurrency(option.priceDeltaCents / 100)})`
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
                          className="h-8 w-8 rounded-full border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleQuantityChange(item.id, -1)}
                          disabled={item.unavailable}
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                        <button
                          className="h-8 w-8 rounded-full border border-slate-200 text-slate-600 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => handleQuantityChange(item.id, 1)}
                          disabled={item.unavailable}
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
                      onChange={(event) => handleItemNotes(item.id, event.target.value)}
                      disabled={item.unavailable}
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
              {shouldShowConvenienceFee && convenienceFeeCents > 0 ? (
                <div className="mt-2 flex items-center justify-between text-slate-700">
                  <span>{convenienceFeeLabel}</span>
                  <span className="font-semibold text-slate-900">
                    {formatCurrency(convenienceFeeCents / 100)}
                  </span>
                </div>
              ) : null}
              <div className="mt-2 flex items-center justify-between text-base font-semibold text-slate-900">
                <span>Total</span>
                <span>{formatCurrency(totalCents / 100)}</span>
              </div>
            </div>

            {!isDineInOrder ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Seus dados</h3>
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Nome completo"
                  value={customerName}
                  autoComplete="name"
                  onChange={(event) => setCustomerName(event.target.value)}
                />
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="WhatsApp / Telefone"
                  value={customerPhone}
                  inputMode="numeric"
                  autoComplete="tel"
                  pattern="[0-9]*"
                  onChange={(event) => {
                    const digits = normalizePhoneDigits(event.target.value);
                    setCustomerPhone(formatPhoneBR(digits));
                  }}
                />
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-blue-600"
                    checked={rememberCustomerData}
                    onChange={(event) => setRememberCustomerData(event.target.checked)}
                  />
                  Lembrar meus dados neste aparelho
                </label>
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Pedido para mesa. Você pode finalizar sem informar nome ou telefone.
              </div>
            )}

            {!isDineInOrder ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Tipo de pedido</h3>
                <div className="flex gap-2">
                  {allowPickup ? (
                    <button
                      className={`flex-1 rounded-full border px-3 py-2 text-sm font-semibold ${
                        fulfillmentType === "PICKUP"
                          ? "border-blue-600 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600"
                      }`}
                      onClick={() => {
                        setFulfillmentType("PICKUP");
                        setDeliveryAreaId("");
                        setAddress(initialAddress);
                      }}
                    >
                      Retirar
                    </button>
                  ) : null}
                  {allowDelivery ? (
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
                  ) : null}
                </div>
              </div>
            ) : null}

            {isDelivery ? (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-700">Endereço</h3>
                <div>
                  <label className="text-xs font-semibold uppercase text-slate-500">Bairro</label>
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
                  autoComplete="street-address"
                  onChange={(event) => setAddress((prev) => ({ ...prev, line: event.target.value }))}
                />
                <input
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Referência (opcional)"
                  value={address.reference}
                  onChange={(event) =>
                    setAddress((prev) => ({ ...prev, reference: event.target.value }))
                  }
                />
              </div>
            ) : null}

            {!isDineInOrder ? (
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
                    {showChangeRequiredError ? (
                      <p className="mt-1 text-xs text-rose-600">
                        Informe o valor do troco para pagamento em dinheiro.
                      </p>
                    ) : null}
                    {showChangeValueError ? (
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
                    {menu.payment.pixName ? <p>Nome: {menu.payment.pixName}</p> : null}
                    {menu.payment.pixBank ? <p>Banco: {menu.payment.pixBank}</p> : null}
                    <button
                      className="mt-2 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-600"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(menu.payment.pixKey);
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
            ) : null}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-700">Observações do pedido</h3>
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
                  ? isDineInOrder
                    ? "Enviar para cozinha"
                    : "Finalizar pedido"
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
                        setOptionError("Selecione as opções obrigatórias para continuar.");
                        return;
                      }
                      setOptionStep((prev) => Math.min(prev + 1, optionGroups.length - 1));
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
                <h3 className="text-lg font-semibold text-slate-900">{currentGroup.name}</h3>
                <p className="text-xs text-slate-500">
                  {currentGroup.type === "SINGLE" ? "Escolha uma opção" : "Escolha múltiplas opções"}
                  {currentGroup.required
                    ? " • Obrigatório"
                    : currentGroup.minSelect > 0
                      ? ` • Mínimo ${currentGroup.minSelect}`
                      : ""}
                  {currentGroup.maxSelect > 0 ? ` • Máximo ${currentGroup.maxSelect}` : ""}
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
                          onChange={() => handleOptionSelection(currentGroup, item.id)}
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
                  Selecione pelo menos {currentGroupValidation?.minRequired} opção(ões) para continuar.
                </p>
              ) : null}

              {optionError ? <p className="text-xs text-rose-600">{optionError}</p> : null}

              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <p className="text-slate-600">Total do item:</p>
                <p className="font-semibold text-slate-900">
                  {formatCurrency(optionFinalPriceCents / 100)}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Nenhuma opção configurada para este produto.</p>
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

      <AppFooter />
    </div>
  );
};

export default PublicOrder;
