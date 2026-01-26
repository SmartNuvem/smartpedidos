import { useEffect, useState } from "react";
import { api } from "../api";

const Dashboard = () => {
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
          setError("Não foi possível carregar os dados da loja.");
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
          <h1>Dashboard</h1>
          <p className="muted">Resumo rápido do painel da loja.</p>
        </div>
      </div>
      {store ? (
        <div className="grid-two">
          <div>
            <h3>Loja</h3>
            <p>{store.name}</p>
            <p className="muted">Slug: {store.slug}</p>
          </div>
          <div>
            <h3>Status</h3>
            <p>{store.isActive ? "Ativa" : "Inativa"}</p>
            <p className="muted">E-mail: {store.email}</p>
          </div>
        </div>
      ) : (
        <p>{error || "Carregando..."}</p>
      )}
    </div>
  );
};

export default Dashboard;
