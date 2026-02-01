import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { getWaiterSlug, getWaiterToken, setWaiterSlug, setWaiterToken } from "../auth";
import Button from "../components/Button";
import Input from "../components/Input";
import WaiterInstallPrompt from "../components/WaiterInstallPrompt";
import WaiterLayout from "../components/WaiterLayout";

const WaiterLogin = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = getWaiterToken();
    const storedSlug = getWaiterSlug();
    if (token && slug && storedSlug === slug) {
      navigate(`/s/${slug}/garcom/mesas`, { replace: true });
    }
  }, [navigate, slug]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!slug) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await api.waiterLogin(slug, pin.trim());
      setWaiterToken(result.waiterToken);
      setWaiterSlug(slug);
      navigate(`/s/${slug}/garcom/mesas`);
    } catch (err) {
      setError(err?.message || "Não foi possível autenticar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <WaiterLayout
      title="Entrar no salão"
      subtitle={slug ? `Loja: ${slug}` : "Digite o PIN para continuar."}
    >
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="PIN do garçom"
            type="password"
            inputMode="numeric"
            placeholder="Digite o PIN"
            value={pin}
            onChange={(event) => setPin(event.target.value)}
          />
          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">
              {error}
            </div>
          ) : null}
          <Button type="submit" disabled={loading || pin.trim().length === 0}>
            {loading ? "Entrando..." : "Entrar"}
          </Button>
        </form>
      </div>

      <WaiterInstallPrompt />
    </WaiterLayout>
  );
};

export default WaiterLogin;
