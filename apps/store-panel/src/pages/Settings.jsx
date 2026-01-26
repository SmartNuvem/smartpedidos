import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";

const Settings = () => {
  const [store, setStore] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .getStore()
      .then((data) => {
        if (active) {
          setStore(data);
        }
      })
      .catch(() => {
        if (active) {
          setError("Não foi possível carregar as configurações.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Configurações
            </h2>
            <p className="text-sm text-slate-500">
              Dados básicos da loja (somente leitura).
            </p>
          </div>
          <Button variant="secondary" disabled>
            Salvar
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {store ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Input label="Nome" type="text" value={store.name} readOnly />
            <Input label="Slug" type="text" value={store.slug} readOnly />
            <Input label="E-mail" type="text" value={store.email} readOnly />
            <Input
              label="Status"
              type="text"
              value={store.isActive ? "Ativa" : "Inativa"}
              readOnly
            />
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            {error || "Carregando..."}
          </p>
        )}
      </div>
    </div>
  );
};

export default Settings;
