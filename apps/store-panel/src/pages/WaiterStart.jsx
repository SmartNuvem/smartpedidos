import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getWaiterSlug } from "../auth";
import WaiterLayout from "../components/WaiterLayout";

const WaiterStart = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const slug = getWaiterSlug();
    if (slug) {
      navigate(`/s/${slug}/garcom`, { replace: true });
    }
  }, [navigate]);

  return (
    <WaiterLayout
      title="Acesso do garçom"
      subtitle="Use o link compartilhado pela loja para entrar no salão."
    >
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <p>
          Abra o link enviado pela gerência (ex.: /s/slug/garcom) para inserir o
          PIN e visualizar as mesas.
        </p>
      </div>
    </WaiterLayout>
  );
};

export default WaiterStart;
