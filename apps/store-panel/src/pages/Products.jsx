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

const Products = () => {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [formState, setFormState] = useState({
    name: "",
    categoryId: "",
    price: "",
    active: true,
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
    });
    setModalOpen(true);
  };

  const openEdit = (product) => {
    setEditingProduct(product);
    setFormState({
      name: product.name,
      categoryId: product.categoryId,
      price: formatDecimal(product.price),
      active: product.active,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingProduct(null);
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
    setSaving(true);
    try {
      const payload = {
        name: formState.name.trim(),
        categoryId: formState.categoryId,
        price: priceValue,
        active: formState.active,
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
        </form>
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
