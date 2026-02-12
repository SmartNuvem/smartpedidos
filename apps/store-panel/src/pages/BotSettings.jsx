import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";

const defaultForm = {
  enabled: false,
  instanceName: "",
  status: "DISCONNECTED",
  connectedPhone: null,
  keywords: "cardapio,menu",
  sendMenuOnKeywords: true,
  sendOrderConfirmation: true,
  menuTemplate:
    "Olá! 👋\n\nAqui está o cardápio da {storeName}:\n{menuUrl}",
  cooldownMinutes: 10,
};

const statusLabel = {
  DISCONNECTED: "Desconectado",
  WAITING_QR: "Aguardando QR",
  CONNECTED: "Conectado",
};

const BotSettings = () => {
  const [form, setForm] = useState(defaultForm);
  const [qrBase64, setQrBase64] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingQr, setLoadingQr] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pollingIntervalRef = useRef(null);
  const pollingTimeoutRef = useRef(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const config = await api.getStoreBotConfig();
        if (!active) return;
        setForm({ ...defaultForm, ...config });
      } catch {
        if (active) setError("Não foi possível carregar as configurações do bot.");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
      stopStatusPolling();
    };
  }, []);

  const stopStatusPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  const refreshWhatsappStatus = async ({ silent = false } = {}) => {
    if (!silent) {
      setError("");
      setMessage("");
    }

    const updated = await api.refreshStoreBotWhatsappStatus();
    setForm((prev) => ({ ...prev, ...updated }));

    if (updated.status === "CONNECTED") {
      stopStatusPolling();
      setQrBase64("");
      if (!silent) {
        setMessage("WhatsApp conectado com sucesso.");
      }
    }

    return updated;
  };

  const startStatusPolling = () => {
    stopStatusPolling();

    pollingIntervalRef.current = window.setInterval(async () => {
      try {
        await refreshWhatsappStatus({ silent: true });
      } catch {
        // silencioso durante polling automático
      }
    }, 2000);

    pollingTimeoutRef.current = window.setTimeout(() => {
      stopStatusPolling();
    }, 60000);
  };

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        enabled: form.enabled,
        keywords: form.keywords,
        sendMenuOnKeywords: form.sendMenuOnKeywords,
        sendOrderConfirmation: form.sendOrderConfirmation,
        menuTemplate: form.menuTemplate,
        cooldownMinutes: Number(form.cooldownMinutes) || 0,
      };
      const updated = await api.updateStoreBotConfig(payload);
      setForm((prev) => ({ ...prev, ...updated }));
      setMessage("Configurações salvas com sucesso.");
    } catch (err) {
      setError(err.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateQr = async () => {
    setLoadingQr(true);
    setError("");
    setMessage("");
    try {
      const result = await api.getStoreBotQr();
      setForm((prev) => ({ ...prev, ...result }));
      setQrBase64(result.qrBase64 || "");
      if (result.status === "WAITING_QR") {
        startStatusPolling();
      } else {
        stopStatusPolling();
        if (result.status === "CONNECTED") {
          setQrBase64("");
        }
      }
      setMessage("QR code atualizado.");
    } catch (err) {
      setError(err.message || "Não foi possível gerar QR.");
    } finally {
      setLoadingQr(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError("");
    setMessage("");
    try {
      stopStatusPolling();
      const updated = await api.disconnectStoreBotWhatsapp();
      setForm((prev) => ({ ...prev, ...updated }));
      setQrBase64("");
      setMessage("Bot desconectado com sucesso.");
    } catch (err) {
      setError(err.message || "Não foi possível desconectar.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefreshStatus = async () => {
    setError("");
    setMessage("");
    try {
      const updated = await refreshWhatsappStatus();
      if (updated.status !== "CONNECTED") {
        setMessage("Status atualizado.");
      }
    } catch (err) {
      setError(err.message || "Não foi possível atualizar status.");
    }
  };

  if (loading) {
    return <div className="rounded-xl border border-slate-200 bg-white p-6">Carregando...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Configurações &gt; Robô/Bot (WhatsApp)</h2>
          <p className="text-sm text-slate-500">InstanceName fixo da loja: <strong>{form.instanceName}</strong></p>
        </div>

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

        <label className="flex items-center gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => handleChange("enabled", event.target.checked)}
          />
          Ativar Bot
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <h3 className="text-md font-semibold text-slate-900">Conexão WhatsApp</h3>
        <p className="text-sm text-slate-600">Instance: <strong>{form.instanceName}</strong></p>
        <p className="text-sm text-slate-600">Status: <strong>{statusLabel[form.status] || form.status}</strong></p>
        {form.connectedPhone ? <p className="text-sm text-slate-600">Telefone conectado: {form.connectedPhone}</p> : null}

        <div className="flex flex-wrap gap-3">
          <Button onClick={handleGenerateQr} disabled={loadingQr}>
            {loadingQr ? "Gerando..." : form.status === "CONNECTED" ? "Regerar QR" : "Gerar QR"}
          </Button>
          <Button onClick={handleRefreshStatus} variant="secondary">
            Atualizar status
          </Button>
          <Button variant="secondary" onClick={handleDisconnect} disabled={disconnecting || form.status === "DISCONNECTED"}>
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </Button>
        </div>

        {qrBase64 && form.status === "WAITING_QR" ? (
          <div className="rounded-lg border border-slate-200 p-4 inline-block">
            <img src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`} alt="QR code WhatsApp" className="h-56 w-56" />
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
        <Input
          label="Keywords (separadas por vírgula)"
          value={form.keywords}
          onChange={(event) => handleChange("keywords", event.target.value)}
        />
        <Input
          label="Cooldown (minutos)"
          type="number"
          value={String(form.cooldownMinutes)}
          onChange={(event) => handleChange("cooldownMinutes", event.target.value)}
        />

        <div className="grid gap-2 text-sm text-slate-700">
          {[
            ["sendMenuOnKeywords", "Enviar cardápio quando detectar keywords"],
            ["sendOrderConfirmation", "Enviar confirmação do pedido"],
          ].map(([field, label]) => (
            <label className="flex items-center gap-3" key={field}>
              <input
                type="checkbox"
                checked={Boolean(form[field])}
                onChange={(event) => handleChange(field, event.target.checked)}
              />
              {label}
            </label>
          ))}
        </div>

        <label className="text-sm font-medium text-slate-700 block">Template de Cardápio</label>
        <textarea
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          rows={4}
          value={form.menuTemplate}
          onChange={(event) => handleChange("menuTemplate", event.target.value)}
        />

        <Button onClick={handleSave} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
      </section>
    </div>
  );
};

export default BotSettings;
