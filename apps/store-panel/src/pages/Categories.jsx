import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";
import Modal from "../components/Modal";
import Table from "../components/Table";
import Toast from "../components/Toast";

const Categories = () => {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [toast, setToast] = useState(null);
  const [movingId, setMovingId] = useState(null);

  const loadCategories = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getCategories();
      setCategories(data);
    } catch {
      setError("Não foi possível carregar as categorias.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCategories();
  }, []);

  const openCreate = () => {
    setEditingCategory(null);
    setFormName("");
    setModalOpen(true);
  };

  const openEdit = (category) => {
    setEditingCategory(category);
    setFormName(category.name);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingCategory(null);
    setFormName("");
  };

  const handleSubmit = async (event) => {
    if (event) {
      event.preventDefault();
    }
    if (!formName.trim()) {
      return;
    }
    setSaving(true);
    try {
      if (editingCategory) {
        await api.updateCategory(editingCategory.id, {
          name: formName.trim(),
        });
        setToast({ message: "Categoria atualizada com sucesso.", variant: "success" });
      } else {
        await api.createCategory({ name: formName.trim() });
        setToast({ message: "Categoria criada com sucesso.", variant: "success" });
      }
      await loadCategories();
      closeModal();
    } catch {
      setToast({ message: "Não foi possível salvar a categoria.", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (category) => {
    try {
      await api.updateCategory(category.id, { active: !category.active });
      await loadCategories();
    } catch {
      setToast({ message: "Não foi possível atualizar a categoria.", variant: "error" });
    }
  };

  const handleMove = async (categoryId, direction) => {
    setMovingId(categoryId);
    try {
      const data = await api.moveCategory(categoryId, direction);
      setCategories(data);
    } catch {
      setToast({ message: "Não foi possível reordenar a categoria.", variant: "error" });
    } finally {
      setMovingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Categorias</h2>
            <p className="text-sm text-slate-500">
              Organize o menu criando e editando categorias.
            </p>
          </div>
          <Button onClick={openCreate}>Adicionar categoria</Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-500">Carregando categorias...</p>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : categories.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">
              Nenhuma categoria cadastrada.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Clique em “Adicionar categoria” para começar.
            </p>
          </div>
        ) : (
          <Table>
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Nome
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">
                  Status
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {categories.map((category, index) => {
                const isFirst = index === 0;
                const isLast = index === categories.length - 1;
                return (
                <tr key={category.id}>
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    {category.name}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        category.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {category.active ? "Ativa" : "Inativa"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="secondary"
                        className="px-3"
                        onClick={() => handleMove(category.id, "up")}
                        disabled={isFirst || movingId === category.id}
                      >
                        ⬆️
                      </Button>
                      <Button
                        variant="secondary"
                        className="px-3"
                        onClick={() => handleMove(category.id, "down")}
                        disabled={isLast || movingId === category.id}
                      >
                        ⬇️
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => openEdit(category)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleToggleActive(category)}
                      >
                        {category.active ? "Desativar" : "Ativar"}
                      </Button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>

      <Modal
        open={modalOpen}
        title={editingCategory ? "Editar categoria" : "Nova categoria"}
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
            label="Nome da categoria"
            value={formName}
            onChange={(event) => setFormName(event.target.value)}
            required
          />
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

export default Categories;
