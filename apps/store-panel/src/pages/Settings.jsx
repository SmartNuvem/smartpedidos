import { useEffect, useState } from "react";
import { api } from "../api";

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
    <div className="card">
      <div className="page-header">
        <div>
          <h1>Configurações</h1>
          <p className="muted">Dados básicos da loja (somente leitura).</p>
        </div>
      </div>

      {store ? (
        <div className="form-grid">
          <label>
            Nome
            <input type="text" value={store.name} readOnly />
          </label>
          <label>
            Slug
            <input type="text" value={store.slug} readOnly />
          </label>
          <label>
            E-mail
            <input type="text" value={store.email} readOnly />
          </label>
          <label>
            Status
            <input
              type="text"
              value={store.isActive ? "Ativa" : "Inativa"}
              readOnly
            />
          </label>
        </div>
      ) : (
        <p>{error || "Carregando..."}</p>
      )}
    </div>
  );
};

export default Settings;
