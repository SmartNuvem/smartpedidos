import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";
import Modal from "../components/Modal";
import Table from "../components/Table";
import Toast from "../components/Toast";

const initialStoreForm = {
  name: "",
  slug: "",
  email: "",
  password: "",
  isActive: true,
  billingModel: "MONTHLY",
  monthlyPrice: "",
  perOrderFee: "0.00",
  showFeeOnPublicMenu: false,
  feeLabel: "Taxa de conveniência do app",
};

const toCents = (value) => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const normalized = String(value).replace(",", ".");
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.round(parsed * 100);
};

const toDisplayValue = (cents) => {
  if (cents === null || cents === undefined) {
    return "";
  }
  return (cents / 100).toFixed(2);
};

const AdminStores = () => {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [formState, setFormState] = useState(initialStoreForm);
  const [editState, setEditState] = useState(null);
  const [resetState, setResetState] = useState({ id: "", name: "" });
  const [deleteState, setDeleteState] = useState({ id: "", name: "" });
  const [resetPassword, setResetPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);

  const activeCount = useMemo(
    () => stores.filter((store) => store.isActive).length,
    [stores]
  );

  const loadStores = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await adminApi.getStores();
      setStores(data);
    } catch (err) {
      setError("Não foi possível carregar as lojas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const handleCreate = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: formState.name,
        slug: formState.slug,
        email: formState.email,
        password: formState.password,
        isActive: formState.isActive,
        billingModel: formState.billingModel,
        monthlyPriceCents: toCents(formState.monthlyPrice),
        perOrderFeeCents: toCents(formState.perOrderFee) ?? 0,
        showFeeOnPublicMenu: formState.showFeeOnPublicMenu,
        feeLabel: formState.feeLabel?.trim() || undefined,
      };
      await adminApi.createStore(payload);
      setCreateOpen(false);
      setFormState(initialStoreForm);
      await loadStores();
    } catch (err) {
      setError(err.message || "Não foi possível criar a loja.");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async (event) => {
    event.preventDefault();
    if (!editState) return;
    setSaving(true);
    try {
      const {
        id,
        name,
        slug,
        email,
        isActive,
        billingModel,
        monthlyPrice,
        perOrderFee,
        showFeeOnPublicMenu,
        feeLabel,
      } = editState;
      await adminApi.updateStore(id, {
        name,
        slug,
        email,
        isActive,
        billingModel,
        monthlyPriceCents: toCents(monthlyPrice),
        perOrderFeeCents: toCents(perOrderFee) ?? 0,
        showFeeOnPublicMenu,
        feeLabel: feeLabel?.trim() || undefined,
      });
      setEditOpen(false);
      setEditState(null);
      await loadStores();
    } catch (err) {
      setError(err.message || "Não foi possível atualizar a loja.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (!resetState.id) return;
    setSaving(true);
    try {
      await adminApi.resetStorePassword(resetState.id, resetPassword);
      setResetOpen(false);
      setResetState({ id: "", name: "" });
      setResetPassword("");
    } catch (err) {
      setError(err.message || "Não foi possível resetar a senha.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (store) => {
    setSaving(true);
    setError("");
    try {
      await adminApi.updateStore(store.id, { isActive: !store.isActive });
      await loadStores();
    } catch (err) {
      setError(err.message || "Não foi possível atualizar o status.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStore = async () => {
    if (!deleteState.id) return;
    setSaving(true);
    setError("");
    try {
      await adminApi.deleteStore(deleteState.id);
      setStores((prev) => prev.filter((store) => store.id !== deleteState.id));
      setDeleteOpen(false);
      setDeleteState({ id: "", name: "" });
      setToast({
        message: "Loja excluída com sucesso",
        variant: "success",
      });
    } catch (err) {
      setError(err.message || "Não foi possível excluir a loja.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Restaurantes</h2>
          <p className="text-sm text-slate-500">
            {activeCount} ativo(s) · {stores.length} total
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>Nova loja</Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <Table>
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Loja</th>
            <th className="px-4 py-3">Slug</th>
            <th className="px-4 py-3">E-mail</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {loading ? (
            <tr>
              <td className="px-4 py-6 text-sm text-slate-500" colSpan={5}>
                Carregando lojas...
              </td>
            </tr>
          ) : stores.length === 0 ? (
            <tr>
              <td className="px-4 py-6 text-sm text-slate-500" colSpan={5}>
                Nenhuma loja cadastrada ainda.
              </td>
            </tr>
          ) : (
            stores.map((store) => (
              <tr key={store.id}>
                <td className="px-4 py-4 text-sm font-medium text-slate-900">
                  {store.name}
                  <div className="text-xs text-slate-500">{store.id}</div>
                </td>
                <td className="px-4 py-4 text-sm text-slate-600">
                  {store.slug}
                </td>
                <td className="px-4 py-4 text-sm text-slate-600">
                  {store.email ?? "-"}
                </td>
                <td className="px-4 py-4 text-sm">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-semibold ${
                      store.isActive
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {store.isActive ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td className="px-4 py-4 text-right text-sm">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => navigate(`/admin/stores/${store.id}`)}
                    >
                      Detalhes
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditState({
                          id: store.id,
                          name: store.name,
                          slug: store.slug,
                          email: store.email ?? "",
                          isActive: store.isActive,
                          billingModel: store.billingModel ?? "MONTHLY",
                          monthlyPrice: toDisplayValue(store.monthlyPriceCents),
                          perOrderFee: toDisplayValue(store.perOrderFeeCents),
                          showFeeOnPublicMenu: store.showFeeOnPublicMenu ?? false,
                          feeLabel:
                            store.feeLabel ?? "Taxa de conveniência do app",
                        });
                        setEditOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setResetState({ id: store.id, name: store.name });
                        setResetPassword("");
                        setResetOpen(true);
                      }}
                    >
                      Resetar senha
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={store.isActive || saving}
                      title={
                        store.isActive
                          ? "Desative a loja antes de excluir"
                          : "Excluir loja"
                      }
                      onClick={() => {
                        setDeleteState({ id: store.id, name: store.name });
                        setDeleteOpen(true);
                      }}
                    >
                      Excluir
                    </Button>
                    <Button
                      variant={store.isActive ? "ghost" : "primary"}
                      size="sm"
                      disabled={saving}
                      onClick={() => handleToggleActive(store)}
                    >
                      {store.isActive ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </Table>

      <Modal
        open={createOpen}
        title="Nova loja"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? "Salvando..." : "Criar loja"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleCreate}>
          <Input
            label="Nome"
            value={formState.name}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, name: event.target.value }))
            }
            required
          />
          <Input
            label="Slug"
            value={formState.slug}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                slug: event.target.value,
              }))
            }
            required
          />
          <p className="-mt-2 text-xs text-slate-500">
            Use apenas letras minúsculas, números e hífen.
          </p>
          <Input
            label="E-mail"
            type="email"
            value={formState.email}
            onChange={(event) =>
              setFormState((prev) => ({ ...prev, email: event.target.value }))
            }
            required
          />
          <Input
            label="Senha inicial"
            type="password"
            value={formState.password}
            onChange={(event) =>
              setFormState((prev) => ({
                ...prev,
                password: event.target.value,
              }))
            }
            required
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={formState.isActive}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  isActive: event.target.checked,
                }))
              }
            />
            Ativar loja automaticamente
          </label>
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-700">Cobrança</h3>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Modelo de cobrança
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={formState.billingModel}
                onChange={(event) => {
                  const model = event.target.value;
                  setFormState((prev) => ({
                    ...prev,
                    billingModel: model,
                    showFeeOnPublicMenu:
                      model === "PER_ORDER" ? prev.showFeeOnPublicMenu : false,
                    perOrderFee: model === "PER_ORDER" ? prev.perOrderFee : "0.00",
                  }));
                }}
              >
                <option value="MONTHLY">Mensal</option>
                <option value="PER_ORDER">Por pedido</option>
              </select>
            </label>
            {formState.billingModel === "MONTHLY" ? (
              <Input
                label="Valor mensal (R$)"
                type="number"
                step="0.01"
                min="0"
                value={formState.monthlyPrice}
                onChange={(event) =>
                  setFormState((prev) => ({
                    ...prev,
                    monthlyPrice: event.target.value,
                  }))
                }
              />
            ) : (
              <>
                <Input
                  label="Taxa por pedido (R$)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formState.perOrderFee}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      perOrderFee: event.target.value,
                    }))
                  }
                />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={formState.showFeeOnPublicMenu}
                    onChange={(event) =>
                      setFormState((prev) => ({
                        ...prev,
                        showFeeOnPublicMenu: event.target.checked,
                      }))
                    }
                  />
                  Exibir taxa no cardápio público
                </label>
                <Input
                  label="Texto da taxa"
                  value={formState.feeLabel}
                  onChange={(event) =>
                    setFormState((prev) => ({
                      ...prev,
                      feeLabel: event.target.value,
                    }))
                  }
                  required
                />
              </>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={editOpen}
        title="Editar loja"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? "Salvando..." : "Salvar alterações"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleEdit}>
          <Input
            label="Nome"
            value={editState?.name ?? ""}
            onChange={(event) =>
              setEditState((prev) => ({ ...prev, name: event.target.value }))
            }
            required
          />
          <Input
            label="Slug"
            value={editState?.slug ?? ""}
            onChange={(event) =>
              setEditState((prev) => ({ ...prev, slug: event.target.value }))
            }
            required
          />
          <p className="-mt-2 text-xs text-slate-500">
            Use apenas letras minúsculas, números e hífen.
          </p>
          <Input
            label="E-mail"
            type="email"
            value={editState?.email ?? ""}
            onChange={(event) =>
              setEditState((prev) => ({ ...prev, email: event.target.value }))
            }
            required
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={Boolean(editState?.isActive)}
              onChange={(event) =>
                setEditState((prev) => ({
                  ...prev,
                  isActive: event.target.checked,
                }))
              }
            />
            Loja ativa
          </label>
          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-sm font-semibold text-slate-700">Cobrança</h3>
            <label className="grid gap-2 text-sm font-medium text-slate-700">
              Modelo de cobrança
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={editState?.billingModel ?? "MONTHLY"}
                onChange={(event) => {
                  const model = event.target.value;
                  setEditState((prev) => ({
                    ...prev,
                    billingModel: model,
                    showFeeOnPublicMenu:
                      model === "PER_ORDER" ? prev.showFeeOnPublicMenu : false,
                    perOrderFee: model === "PER_ORDER" ? prev.perOrderFee : "0.00",
                  }));
                }}
              >
                <option value="MONTHLY">Mensal</option>
                <option value="PER_ORDER">Por pedido</option>
              </select>
            </label>
            {editState?.billingModel === "MONTHLY" ? (
              <Input
                label="Valor mensal (R$)"
                type="number"
                step="0.01"
                min="0"
                value={editState?.monthlyPrice ?? ""}
                onChange={(event) =>
                  setEditState((prev) => ({
                    ...prev,
                    monthlyPrice: event.target.value,
                  }))
                }
              />
            ) : (
              <>
                <Input
                  label="Taxa por pedido (R$)"
                  type="number"
                  step="0.01"
                  min="0"
                  value={editState?.perOrderFee ?? ""}
                  onChange={(event) =>
                    setEditState((prev) => ({
                      ...prev,
                      perOrderFee: event.target.value,
                    }))
                  }
                />
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={Boolean(editState?.showFeeOnPublicMenu)}
                    onChange={(event) =>
                      setEditState((prev) => ({
                        ...prev,
                        showFeeOnPublicMenu: event.target.checked,
                      }))
                    }
                  />
                  Exibir taxa no cardápio público
                </label>
                <Input
                  label="Texto da taxa"
                  value={editState?.feeLabel ?? ""}
                  onChange={(event) =>
                    setEditState((prev) => ({
                      ...prev,
                      feeLabel: event.target.value,
                    }))
                  }
                  required
                />
              </>
            )}
          </div>
        </form>
      </Modal>

      <Modal
        open={resetOpen}
        title={`Resetar senha - ${resetState.name}`}
        onClose={() => setResetOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleResetPassword} disabled={saving}>
              {saving ? "Salvando..." : "Resetar senha"}
            </Button>
          </>
        }
      >
        <form className="space-y-4" onSubmit={handleResetPassword}>
          <Input
            label="Nova senha"
            type="password"
            value={resetPassword}
            onChange={(event) => setResetPassword(event.target.value)}
            required
          />
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        title={`Excluir loja - ${deleteState.name}`}
        onClose={() => setDeleteOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={handleDeleteStore}
              disabled={saving}
            >
              {saving ? "Excluindo..." : "Excluir loja"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Tem certeza que deseja excluir esta loja?
        </p>
        <p className="text-sm font-semibold text-slate-900">
          Todos os dados serão apagados e essa ação não pode ser desfeita.
        </p>
      </Modal>

      <Toast
        message={toast?.message}
        variant={toast?.variant}
        onClose={() => setToast(null)}
      />
    </div>
  );
};

export default AdminStores;
