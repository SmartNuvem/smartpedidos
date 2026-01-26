import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";
import Modal from "../components/Modal";
import Table from "../components/Table";

const initialStoreForm = {
  name: "",
  slug: "",
  email: "",
  password: "",
  active: true,
};

const AdminStores = () => {
  const [stores, setStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [formState, setFormState] = useState(initialStoreForm);
  const [editState, setEditState] = useState(null);
  const [resetState, setResetState] = useState({ id: "", name: "" });
  const [resetPassword, setResetPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const activeCount = useMemo(
    () => stores.filter((store) => store.active).length,
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
      await adminApi.createStore(formState);
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
      const { id, name, slug, email, active } = editState;
      await adminApi.updateStore(id, { name, slug, email, active });
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
      await adminApi.updateStore(store.id, { active: !store.active });
      await loadStores();
    } catch (err) {
      setError(err.message || "Não foi possível atualizar o status.");
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
                      store.active
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {store.active ? "Ativa" : "Inativa"}
                  </span>
                </td>
                <td className="px-4 py-4 text-right text-sm">
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditState({
                          id: store.id,
                          name: store.name,
                          slug: store.slug,
                          email: store.email ?? "",
                          active: store.active,
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
                      variant={store.active ? "ghost" : "primary"}
                      size="sm"
                      disabled={saving}
                      onClick={() => handleToggleActive(store)}
                    >
                      {store.active ? "Desativar" : "Ativar"}
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
              checked={formState.active}
              onChange={(event) =>
                setFormState((prev) => ({
                  ...prev,
                  active: event.target.checked,
                }))
              }
            />
            Ativar loja automaticamente
          </label>
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
              checked={Boolean(editState?.active)}
              onChange={(event) =>
                setEditState((prev) => ({
                  ...prev,
                  active: event.target.checked,
                }))
              }
            />
            Loja ativa
          </label>
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
    </div>
  );
};

export default AdminStores;
