import { useEffect, useMemo, useState } from "react";
import { api, formatCurrency, formatDecimal } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";
import Modal from "../components/Modal";
import Select from "../components/Select";
import Table from "../components/Table";
import Toast from "../components/Toast";

const parsePrice = (value) => {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? null : parsed;
};

const parsePriceCents = (value) => {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }
  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * 100);
};

const parseIntValue = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const normalizeGroupRules = (group) => {
  const minSelect = parseIntValue(group.minSelect ?? 0, 0);
  const maxSelect = parseIntValue(group.maxSelect ?? 0, 0);

  if (group.type === "SINGLE") {
    return {
      ...group,
      minSelect: group.required ? 1 : 0,
      maxSelect: 1,
    };
  }

  let normalizedMin = minSelect;
  let normalizedMax = maxSelect;
  if (group.required && normalizedMin === 0) {
    normalizedMin = 1;
  }
  if (normalizedMax > 0 && normalizedMax < normalizedMin) {
    normalizedMax = normalizedMin;
  }

  return {
    ...group,
    minSelect: normalizedMin,
    maxSelect: normalizedMax,
  };
};

const dayOptions = [
  { label: "Seg", value: 1 },
  { label: "Ter", value: 2 },
  { label: "Qua", value: 3 },
  { label: "Qui", value: 4 },
  { label: "Sex", value: 5 },
  { label: "Sáb", value: 6 },
  { label: "Dom", value: 7 },
];

const Products = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [optionsModalOpen, setOptionsModalOpen] = useState(false);
  const [optionsProduct, setOptionsProduct] = useState(null);
  const [optionGroups, setOptionGroups] = useState([]);
  const [optionLoading, setOptionLoading] = useState(false);
  const [optionError, setOptionError] = useState("");
  const [groupDraft, setGroupDraft] = useState({
    name: "",
    type: "SINGLE",
    required: false,
    minSelect: 0,
    maxSelect: 0,
    sortOrder: 0,
  });
  const [itemDrafts, setItemDrafts] = useState({});
  const [formState, setFormState] = useState({
    name: "",
    categoryId: "",
    price: "",
    active: true,
    availableEveryday: true,
    availableDays: [],
  });
  const [toast, setToast] = useState(null);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [productsData, categoriesData] = await Promise.all([
        api.getProducts(),
        api.getCategories(),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch {
      setError("Não foi possível carregar os produtos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const categoryMap = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories]
  );

  const openCreate = () => {
    setEditingProduct(null);
    setFormState({
      name: "",
      categoryId: categories[0]?.id ?? "",
      price: "",
      active: true,
      availableEveryday: true,
      availableDays: [],
    });
    setModalOpen(true);
  };

  const openEdit = (product) => {
    const availableDays = product.availableDays ?? [];
    const availableEveryday = availableDays.length === 0;
    setEditingProduct(product);
    setFormState({
      name: product.name,
      categoryId: product.categoryId,
      price: formatDecimal(product.price),
      active: product.active,
      availableEveryday,
      availableDays,
    });
    setModalOpen(true);
  };

  const openOptions = (product) => {
    setOptionsProduct(product);
    setOptionsModalOpen(true);
    setGroupDraft({
      name: "",
      type: "SINGLE",
      required: false,
      minSelect: 0,
      maxSelect: 0,
      sortOrder: 0,
    });
    setItemDrafts({});
    loadOptionGroups(product.id);
  };

  const closeOptionsModal = () => {
    setOptionsModalOpen(false);
    setOptionsProduct(null);
    setOptionGroups([]);
    setOptionError("");
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
  };

  const loadOptionGroups = async (productId) => {
    setOptionLoading(true);
    setOptionError("");
    try {
      const data = await api.getProductOptionGroups(productId);
      setOptionGroups(data);
    } catch {
      setOptionError("Não foi possível carregar as opções.");
    } finally {
      setOptionLoading(false);
    }
  };

  const updateGroupField = (groupId, field, value) => {
    setOptionGroups((prev) =>
      prev.map((group) =>
        group.id === groupId
          ? normalizeGroupRules({ ...group, [field]: value })
          : group
      )
    );
  };

  const updateItemField = (groupId, itemId, field, value) => {
    setOptionGroups((prev) =>
      prev.map((group) => {
        if (group.id !== groupId) {
          return group;
        }
        return {
          ...group,
          items: group.items.map((item) =>
            item.id === itemId ? { ...item, [field]: value } : item
          ),
        };
      })
    );
  };

  const updateItemDraft = (groupId, field, value) => {
    setItemDrafts((prev) => ({
      ...prev,
      [groupId]: {
        name: "",
        priceDelta: "",
        sortOrder: 0,
        isActive: true,
        ...(prev[groupId] ?? {}),
        [field]: value,
      },
    }));
  };

  const handleCreateGroup = async () => {
    if (!optionsProduct || !groupDraft.name.trim()) {
      setToast({ message: "Informe o nome do grupo.", variant: "error" });
      return;
    }
    try {
      const normalizedDraft = normalizeGroupRules(groupDraft);
      await api.createProductOptionGroup(optionsProduct.id, {
        name: normalizedDraft.name.trim(),
        type: normalizedDraft.type,
        required: normalizedDraft.required,
        minSelect: parseIntValue(normalizedDraft.minSelect, 0),
        maxSelect: parseIntValue(normalizedDraft.maxSelect, 0),
        sortOrder: parseIntValue(normalizedDraft.sortOrder, 0),
      });
      setGroupDraft({
        name: "",
        type: "SINGLE",
        required: false,
        minSelect: 0,
        maxSelect: 0,
        sortOrder: 0,
      });
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível criar o grupo.", variant: "error" });
    }
  };

  const handleSaveGroup = async (group) => {
    try {
      const normalizedGroup = normalizeGroupRules(group);
      await api.updateOptionGroup(group.id, {
        name: normalizedGroup.name,
        type: normalizedGroup.type,
        required: normalizedGroup.required,
        minSelect: parseIntValue(normalizedGroup.minSelect, 0),
        maxSelect: parseIntValue(normalizedGroup.maxSelect, 0),
        sortOrder: parseIntValue(normalizedGroup.sortOrder, 0),
      });
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível salvar o grupo.", variant: "error" });
    }
  };

  const handleDeleteGroup = async (groupId) => {
    try {
      await api.deleteOptionGroup(groupId);
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível remover o grupo.", variant: "error" });
    }
  };

  const handleCreateItem = async (groupId) => {
    const draft = itemDrafts[groupId] ?? {
      name: "",
      priceDelta: "",
      sortOrder: 0,
      isActive: true,
    };
    if (!draft.name.trim()) {
      setToast({ message: "Informe o nome do item.", variant: "error" });
      return;
    }
    try {
      await api.createOptionGroupItem(groupId, {
        name: draft.name.trim(),
        priceDeltaCents: parsePriceCents(draft.priceDelta),
        sortOrder: parseIntValue(draft.sortOrder, 0),
        isActive: draft.isActive,
      });
      updateItemDraft(groupId, "name", "");
      updateItemDraft(groupId, "priceDelta", "");
      updateItemDraft(groupId, "sortOrder", 0);
      updateItemDraft(groupId, "isActive", true);
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível criar o item.", variant: "error" });
    }
  };

  const handleSaveItem = async (groupId, item) => {
    try {
      await api.updateOptionGroupItem(groupId, item.id, {
        name: item.name,
        priceDeltaCents: item.priceDeltaCents,
        sortOrder: parseIntValue(item.sortOrder, 0),
        isActive: item.isActive,
      });
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível salvar o item.", variant: "error" });
    }
  };

  const handleDeleteItem = async (groupId, itemId) => {
    try {
      await api.deleteOptionGroupItem(groupId, itemId);
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível remover o item.", variant: "error" });
    }
  };

  const handleMoveGroup = async (groupId, direction) => {
    const sorted = [...optionGroups].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
    const index = sorted.findIndex((group) => group.id === groupId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const current = sorted[index];
    const target = sorted[targetIndex];
    try {
      await Promise.all([
        api.updateOptionGroup(current.id, { sortOrder: target.sortOrder }),
        api.updateOptionGroup(target.id, { sortOrder: current.sortOrder }),
      ]);
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível mover o grupo.", variant: "error" });
    }
  };

  const handleMoveItem = async (groupId, itemId, direction) => {
    const group = optionGroups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    const sorted = [...group.items].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );
    const index = sorted.findIndex((item) => item.id === itemId);
    const targetIndex = index + direction;
    if (index === -1 || targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const current = sorted[index];
    const target = sorted[targetIndex];
    try {
      await Promise.all([
        api.updateOptionGroupItem(groupId, current.id, {
          sortOrder: target.sortOrder,
        }),
        api.updateOptionGroupItem(groupId, target.id, {
          sortOrder: current.sortOrder,
        }),
      ]);
      await loadOptionGroups(optionsProduct.id);
    } catch {
      setToast({ message: "Não foi possível mover o item.", variant: "error" });
    }
  };

  const handleChange = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    if (event) {
      event.preventDefault();
    }
    const priceValue = parsePrice(formState.price);
    if (!formState.name.trim() || !formState.categoryId || priceValue === null) {
      setToast({ message: "Preencha todos os campos obrigatórios.", variant: "error" });
      return;
    }
    if (!formState.availableEveryday && formState.availableDays.length === 0) {
      setToast({
        message: "Selecione ao menos um dia de disponibilidade.",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formState.name.trim(),
        categoryId: formState.categoryId,
        price: priceValue,
        active: formState.active,
        availableDays: formState.availableEveryday
          ? []
          : formState.availableDays,
      };
      if (editingProduct) {
        await api.updateProduct(editingProduct.id, payload);
        setToast({ message: "Produto atualizado com sucesso.", variant: "success" });
      } else {
        await api.createProduct(payload);
        setToast({ message: "Produto criado com sucesso.", variant: "success" });
      }
      await loadData();
      closeModal();
    } catch {
      setToast({ message: "Não foi possível salvar o produto.", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (product) => {
    try {
      await api.updateProduct(product.id, { active: !product.active });
      await loadData();
    } catch {
      setToast({ message: "Não foi possível atualizar o produto.", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Produtos</h2>
            <p className="text-sm text-slate-500">
              Cadastre produtos, defina preços e organize o cardápio.
            </p>
          </div>
          <Button onClick={openCreate}>Adicionar produto</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando produtos...</p>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">
              Nenhum produto cadastrado.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Use o botão “Adicionar produto” para começar.
            </p>
          </div>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Produto
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Categoria
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Preço
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {products.map((product) => (
                <tr key={product.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {product.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {categoryMap.get(product.categoryId)?.name ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-slate-900">
                    {formatCurrency(product.price)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        product.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {product.active ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => openOptions(product)}
                      >
                        Opções
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => openEdit(product)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleToggleActive(product)}
                      >
                        {product.active ? "Desativar" : "Ativar"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editingProduct ? "Editar produto" : "Novo produto"}
        onClose={closeModal}
        footer={
          <>
            <Button variant="secondary" onClick={closeModal}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="Nome do produto"
            value={formState.name}
            onChange={(event) => handleChange("name", event.target.value)}
            required
          />
          <Select
            label="Categoria"
            value={formState.categoryId}
            onChange={(event) => handleChange("categoryId", event.target.value)}
            required
          >
            <option value="" disabled>
              Selecione uma categoria
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Input
            label="Preço"
            placeholder="0,00"
            value={formState.price}
            onChange={(event) => handleChange("price", event.target.value)}
            required
          />
          <Select
            label="Status"
            value={formState.active ? "true" : "false"}
            onChange={(event) =>
              handleChange("active", event.target.value === "true")
            }
          >
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
          </Select>
          <div className="rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700">
              Disponibilidade
            </h3>
            <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={formState.availableEveryday}
                onChange={(event) =>
                  handleChange("availableEveryday", event.target.checked)
                }
              />
              Disponível todos os dias
            </label>
            {!formState.availableEveryday ? (
              <div className="mt-4 grid gap-2 sm:grid-cols-4">
                {dayOptions.map((day) => (
                  <label
                    key={day.value}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      type="checkbox"
                      checked={formState.availableDays.includes(day.value)}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        handleChange(
                          "availableDays",
                          checked
                            ? [...formState.availableDays, day.value].sort(
                                (a, b) => a - b
                              )
                            : formState.availableDays.filter(
                                (value) => value !== day.value
                              )
                        );
                      }}
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </form>
      </Modal>

      <Modal
        open={optionsModalOpen}
        title={
          optionsProduct ? `Opções • ${optionsProduct.name}` : "Opções"
        }
        onClose={closeOptionsModal}
        containerClassName="max-h-[80vh] max-w-4xl overflow-hidden"
        headerClassName="pb-4 border-b border-slate-200"
        bodyClassName="mt-4 flex-1 overflow-y-auto space-y-6 pr-1"
        footerClassName="border-t border-slate-200 pt-4"
        footer={
          <Button variant="secondary" onClick={closeOptionsModal}>
            Fechar
          </Button>
        }
      >
        {optionLoading ? (
          <p className="text-sm text-slate-500">Carregando opções...</p>
        ) : optionError ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {optionError}
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-700">
                Novo grupo de opções
              </h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Input
                  label="Nome"
                  value={groupDraft.name}
                  placeholder="Tamanho do copo"
                  onChange={(event) =>
                    setGroupDraft((prev) =>
                      normalizeGroupRules({
                        ...prev,
                        name: event.target.value,
                      })
                    )
                  }
                />
                <Select
                  label="Tipo"
                  value={groupDraft.type}
                  onChange={(event) =>
                    setGroupDraft((prev) =>
                      normalizeGroupRules({
                        ...prev,
                        type: event.target.value,
                      })
                    )
                  }
                >
                  <option value="SINGLE">Única escolha</option>
                  <option value="MULTI">Múltipla escolha</option>
                </Select>
                <Input
                  label="Mínimo"
                  type="number"
                  value={groupDraft.minSelect}
                  disabled={groupDraft.type === "SINGLE"}
                  onChange={(event) =>
                    setGroupDraft((prev) =>
                      normalizeGroupRules({
                        ...prev,
                        minSelect: event.target.value,
                      })
                    )
                  }
                />
                <Input
                  label="Máximo"
                  type="number"
                  value={groupDraft.maxSelect}
                  disabled={groupDraft.type === "SINGLE"}
                  onChange={(event) =>
                    setGroupDraft((prev) =>
                      normalizeGroupRules({
                        ...prev,
                        maxSelect: event.target.value,
                      })
                    )
                  }
                />
                <Input
                  label="Ordem"
                  type="number"
                  value={groupDraft.sortOrder}
                  onChange={(event) =>
                    setGroupDraft((prev) => ({
                      ...prev,
                      sortOrder: event.target.value,
                    }))
                  }
                />
                <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={groupDraft.required}
                    onChange={(event) =>
                      setGroupDraft((prev) =>
                        normalizeGroupRules({
                          ...prev,
                          required: event.target.checked,
                        })
                      )
                    }
                  />
                  Obrigatório
                </label>
              </div>
              <div className="mt-4">
                <Button onClick={handleCreateGroup}>Adicionar grupo</Button>
              </div>
            </div>

            {optionGroups.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum grupo cadastrado.
              </p>
            ) : (
              optionGroups.map((group) => (
                <div
                  key={group.id}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-700">
                      {group.name}
                    </h4>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={() => handleMoveGroup(group.id, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => handleMoveGroup(group.id, 1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Nome"
                      value={group.name}
                      placeholder="Sabor"
                      onChange={(event) =>
                        updateGroupField(group.id, "name", event.target.value)
                      }
                    />
                    <Select
                      label="Tipo"
                      value={group.type}
                      onChange={(event) =>
                        updateGroupField(group.id, "type", event.target.value)
                      }
                    >
                      <option value="SINGLE">Única escolha</option>
                      <option value="MULTI">Múltipla escolha</option>
                    </Select>
                    <Input
                      label="Mínimo"
                      type="number"
                      value={group.minSelect}
                      disabled={group.type === "SINGLE"}
                      onChange={(event) =>
                        updateGroupField(
                          group.id,
                          "minSelect",
                          event.target.value
                        )
                      }
                    />
                    <Input
                      label="Máximo"
                      type="number"
                      value={group.maxSelect}
                      disabled={group.type === "SINGLE"}
                      onChange={(event) =>
                        updateGroupField(
                          group.id,
                          "maxSelect",
                          event.target.value
                        )
                      }
                    />
                    <Input
                      label="Ordem"
                      type="number"
                      value={group.sortOrder}
                      onChange={(event) =>
                        updateGroupField(
                          group.id,
                          "sortOrder",
                          event.target.value
                        )
                      }
                    />
                    <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={group.required}
                        onChange={(event) =>
                          updateGroupField(
                            group.id,
                            "required",
                            event.target.checked
                          )
                        }
                      />
                      Obrigatório
                    </label>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => handleSaveGroup(group)}>
                      Salvar grupo
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => handleDeleteGroup(group.id)}
                    >
                      Remover grupo
                    </Button>
                  </div>

                  <div className="mt-5 border-t border-slate-200 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h5 className="text-sm font-semibold text-slate-700">
                        Itens do grupo
                      </h5>
                    </div>

                    <div className="mt-3 space-y-3">
                      {group.items.map((item) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-slate-200 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-700">
                              {item.name}
                            </span>
                            <div className="flex gap-2">
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  handleMoveItem(group.id, item.id, -1)
                                }
                              >
                                ↑
                              </Button>
                              <Button
                                variant="secondary"
                                onClick={() =>
                                  handleMoveItem(group.id, item.id, 1)
                                }
                              >
                                ↓
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <Input
                              label="Nome"
                              value={item.name}
                              onChange={(event) =>
                                updateItemField(
                                  group.id,
                                  item.id,
                                  "name",
                                  event.target.value
                                )
                              }
                            />
                            <Input
                              label="Preço adicional"
                              value={formatDecimal(item.priceDeltaCents / 100)}
                              onChange={(event) =>
                                updateItemField(
                                  group.id,
                                  item.id,
                                  "priceDeltaCents",
                                  parsePriceCents(event.target.value)
                                )
                              }
                            />
                            <Input
                              label="Ordem"
                              type="number"
                              value={item.sortOrder}
                              onChange={(event) =>
                                updateItemField(
                                  group.id,
                                  item.id,
                                  "sortOrder",
                                  event.target.value
                                )
                              }
                            />
                            <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                checked={item.isActive}
                                onChange={(event) =>
                                  updateItemField(
                                    group.id,
                                    item.id,
                                    "isActive",
                                    event.target.checked
                                  )
                                }
                              />
                              Ativo
                            </label>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              onClick={() => handleSaveItem(group.id, item)}
                            >
                              Salvar item
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() =>
                                handleDeleteItem(group.id, item.id)
                              }
                            >
                              Remover item
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3">
                      <h6 className="text-xs font-semibold uppercase text-slate-500">
                        Novo item
                      </h6>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Input
                          label="Nome"
                          value={itemDrafts[group.id]?.name ?? ""}
                          onChange={(event) =>
                            updateItemDraft(group.id, "name", event.target.value)
                          }
                        />
                        <Input
                          label="Preço adicional"
                          placeholder="0,00"
                          value={itemDrafts[group.id]?.priceDelta ?? ""}
                          onChange={(event) =>
                            updateItemDraft(
                              group.id,
                              "priceDelta",
                              event.target.value
                            )
                          }
                        />
                        <Input
                          label="Ordem"
                          type="number"
                          value={itemDrafts[group.id]?.sortOrder ?? 0}
                          onChange={(event) =>
                            updateItemDraft(
                              group.id,
                              "sortOrder",
                              event.target.value
                            )
                          }
                        />
                        <label className="mt-6 flex items-center gap-2 text-sm font-semibold text-slate-700">
                          <input
                            type="checkbox"
                            checked={itemDrafts[group.id]?.isActive ?? true}
                            onChange={(event) =>
                              updateItemDraft(
                                group.id,
                                "isActive",
                                event.target.checked
                              )
                            }
                          />
                          Ativo
                        </label>
                      </div>
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          onClick={() => handleCreateItem(group.id)}
                        >
                          Adicionar item
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </Modal>

      <Toast
        message={toast?.message}
        variant={toast?.variant}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

export default Products;
