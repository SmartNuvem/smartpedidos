import { useEffect, useState } from "react";
import { api } from "../api";
import Button from "../components/Button";
import Input from "../components/Input";

const DAYS = [
  { key: "mon", label: "Segunda" },
  { key: "tue", label: "Terça" },
  { key: "wed", label: "Quarta" },
  { key: "thu", label: "Quinta" },
  { key: "fri", label: "Sexta" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

const Settings = () => {
  const [store, setStore] = useState(null);
  const [deliveryAreas, setDeliveryAreas] = useState([]);
  const [hours, setHours] = useState(null);
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState("");
  const [savingHours, setSavingHours] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [areaSavingId, setAreaSavingId] = useState(null);
  const [areaError, setAreaError] = useState("");
  const [newArea, setNewArea] = useState({
    name: "",
    feeCents: 0,
    sortOrder: 0,
    isActive: true,
  });

  const hasAreas = deliveryAreas.length > 0;

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      setError("");
      try {
        const [storeData, areasData, hoursData, paymentData] =
          await Promise.all([
            api.getStore(),
            api.getDeliveryAreas(),
            api.getStoreHours(),
            api.getPaymentSettings(),
          ]);
        if (!active) {
          return;
        }
        setStore(storeData);
        setDeliveryAreas(areasData);
        setHours(hoursData);
        setPayment(paymentData);
      } catch {
        if (active) {
          setError("Não foi possível carregar as configurações.");
        }
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const handleAreaChange = (id, field, value) => {
    setDeliveryAreas((prev) =>
      prev.map((area) =>
        area.id === id ? { ...area, [field]: value } : area
      )
    );
  };

  const handleSaveArea = async (area) => {
    setAreaSavingId(area.id);
    setAreaError("");
    try {
      const updated = await api.updateDeliveryArea(area.id, {
        name: area.name,
        feeCents: area.feeCents,
        sortOrder: area.sortOrder,
        isActive: area.isActive,
      });
      setDeliveryAreas((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item))
      );
    } catch {
      setAreaError("Não foi possível salvar a taxa de entrega.");
    } finally {
      setAreaSavingId(null);
    }
  };

  const handleDeleteArea = async (id) => {
    setAreaSavingId(id);
    setAreaError("");
    try {
      await api.deleteDeliveryArea(id);
      setDeliveryAreas((prev) => prev.filter((area) => area.id !== id));
    } catch {
      setAreaError("Não foi possível remover a taxa de entrega.");
    } finally {
      setAreaSavingId(null);
    }
  };

  const handleCreateArea = async () => {
    if (!newArea.name.trim()) {
      setAreaError("Informe o bairro antes de salvar.");
      return;
    }
    setAreaSavingId("new");
    setAreaError("");
    try {
      const created = await api.createDeliveryArea({
        name: newArea.name.trim(),
        feeCents: newArea.feeCents,
        sortOrder: newArea.sortOrder,
        isActive: newArea.isActive,
      });
      setDeliveryAreas((prev) => [...prev, created]);
      setNewArea({ name: "", feeCents: 0, sortOrder: 0, isActive: true });
    } catch {
      setAreaError("Não foi possível criar a taxa de entrega.");
    } finally {
      setAreaSavingId(null);
    }
  };

  const handleSaveHours = async () => {
    if (!hours) {
      return;
    }
    setSavingHours(true);
    try {
      const normalized = {
        ...hours,
        monOpen: hours.monOpen || null,
        monClose: hours.monClose || null,
        tueOpen: hours.tueOpen || null,
        tueClose: hours.tueClose || null,
        wedOpen: hours.wedOpen || null,
        wedClose: hours.wedClose || null,
        thuOpen: hours.thuOpen || null,
        thuClose: hours.thuClose || null,
        friOpen: hours.friOpen || null,
        friClose: hours.friClose || null,
        satOpen: hours.satOpen || null,
        satClose: hours.satClose || null,
        sunOpen: hours.sunOpen || null,
        sunClose: hours.sunClose || null,
        closedMessage: hours.closedMessage || null,
      };
      const updated = await api.updateStoreHours(normalized);
      setHours(updated);
    } catch {
      setError("Não foi possível salvar os horários.");
    } finally {
      setSavingHours(false);
    }
  };

  const handleSavePayment = async () => {
    if (!payment) {
      return;
    }
    setSavingPayment(true);
    try {
      const normalized = {
        ...payment,
        pixKey: payment.pixKey || null,
        pixName: payment.pixName || null,
        pixBank: payment.pixBank || null,
      };
      const updated = await api.updatePaymentSettings(normalized);
      setPayment(updated);
    } catch {
      setError("Não foi possível salvar as formas de pagamento.");
    } finally {
      setSavingPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              Configurações
            </h2>
            <p className="text-sm text-slate-500">
              Dados básicos da loja e opções de atendimento.
            </p>
          </div>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Taxas de entrega por bairro
            </h3>
            <p className="text-sm text-slate-500">
              Configure bairros atendidos e taxas em reais.
            </p>
          </div>
        </div>

        {areaError ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {areaError}
          </div>
        ) : null}

        <div className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-xl border border-dashed border-slate-200 p-4 md:grid-cols-[2fr_1fr_1fr_auto]">
            <Input
              label="Bairro"
              value={newArea.name}
              onChange={(event) =>
                setNewArea((prev) => ({ ...prev, name: event.target.value }))
              }
            />
            <Input
              label="Taxa (R$)"
              type="number"
              step="0.01"
              value={(newArea.feeCents / 100).toFixed(2)}
              onChange={(event) =>
                setNewArea((prev) => ({
                  ...prev,
                  feeCents: Math.round(Number(event.target.value || 0) * 100),
                }))
              }
            />
            <Input
              label="Ordem"
              type="number"
              value={newArea.sortOrder}
              onChange={(event) =>
                setNewArea((prev) => ({
                  ...prev,
                  sortOrder: Number(event.target.value || 0),
                }))
              }
            />
            <div className="flex items-end">
              <Button
                onClick={handleCreateArea}
                disabled={areaSavingId === "new"}
              >
                {areaSavingId === "new" ? "Salvando..." : "Adicionar"}
              </Button>
            </div>
          </div>

          {hasAreas ? (
            <div className="space-y-3">
              {deliveryAreas.map((area) => (
                <div
                  key={area.id}
                  className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[2fr_1fr_1fr_auto_auto]"
                >
                  <Input
                    label="Bairro"
                    value={area.name}
                    onChange={(event) =>
                      handleAreaChange(area.id, "name", event.target.value)
                    }
                  />
                  <Input
                    label="Taxa (R$)"
                    type="number"
                    step="0.01"
                    value={(area.feeCents / 100).toFixed(2)}
                    onChange={(event) =>
                      handleAreaChange(
                        area.id,
                        "feeCents",
                        Math.round(Number(event.target.value || 0) * 100)
                      )
                    }
                  />
                  <Input
                    label="Ordem"
                    type="number"
                    value={area.sortOrder}
                    onChange={(event) =>
                      handleAreaChange(
                        area.id,
                        "sortOrder",
                        Number(event.target.value || 0)
                      )
                    }
                  />
                  <label className="flex items-end gap-2 text-sm font-medium text-slate-600">
                    <input
                      type="checkbox"
                      checked={area.isActive}
                      onChange={(event) =>
                        handleAreaChange(
                          area.id,
                          "isActive",
                          event.target.checked
                        )
                      }
                    />
                    Ativo
                  </label>
                  <div className="flex items-end gap-2">
                    <Button
                      onClick={() => handleSaveArea(area)}
                      disabled={areaSavingId === area.id}
                    >
                      {areaSavingId === area.id ? "Salvando..." : "Salvar"}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleDeleteArea(area.id)}
                      disabled={areaSavingId === area.id}
                    >
                      Remover
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Nenhum bairro cadastrado ainda.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Horário de funcionamento
            </h3>
            <p className="text-sm text-slate-500">
              Defina horários por dia ou force aberto/fechado.
            </p>
          </div>
          <Button onClick={handleSaveHours} disabled={savingHours}>
            {savingHours ? "Salvando..." : "Salvar horários"}
          </Button>
        </div>

        {hours ? (
          <div className="mt-4 space-y-4">
            <Input
              label="Timezone"
              value={hours.timezone}
              onChange={(event) =>
                setHours((prev) => ({ ...prev, timezone: event.target.value }))
              }
            />
            <div className="grid gap-3">
              {DAYS.map((day) => (
                <div
                  key={day.key}
                  className="grid items-center gap-3 rounded-xl border border-slate-100 p-3 md:grid-cols-[1fr_auto_auto_auto]"
                >
                  <span className="text-sm font-semibold text-slate-700">
                    {day.label}
                  </span>
                  <input
                    type="time"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    value={hours[`${day.key}Open`] || ""}
                    onChange={(event) =>
                      setHours((prev) => ({
                        ...prev,
                        [`${day.key}Open`]: event.target.value,
                      }))
                    }
                  />
                  <input
                    type="time"
                    className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    value={hours[`${day.key}Close`] || ""}
                    onChange={(event) =>
                      setHours((prev) => ({
                        ...prev,
                        [`${day.key}Close`]: event.target.value,
                      }))
                    }
                  />
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={hours[`${day.key}Enabled`]}
                      onChange={(event) =>
                        setHours((prev) => ({
                          ...prev,
                          [`${day.key}Enabled`]: event.target.checked,
                        }))
                      }
                    />
                    Ativo
                  </label>
                </div>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium text-slate-700">
                Forçar status
                <select
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={hours.isOpenNowOverride}
                  onChange={(event) =>
                    setHours((prev) => ({
                      ...prev,
                      isOpenNowOverride: event.target.value,
                    }))
                  }
                >
                  <option value="AUTO">Automático</option>
                  <option value="FORCE_OPEN">Forçar aberto</option>
                  <option value="FORCE_CLOSED">Forçar fechado</option>
                </select>
              </label>
              <Input
                label="Mensagem quando fechado"
                value={hours.closedMessage || ""}
                onChange={(event) =>
                  setHours((prev) => ({
                    ...prev,
                    closedMessage: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">Carregando horários...</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              Formas de pagamento
            </h3>
            <p className="text-sm text-slate-500">
              Informe quais métodos são aceitos e dados PIX.
            </p>
          </div>
          <Button onClick={handleSavePayment} disabled={savingPayment}>
            {savingPayment ? "Salvando..." : "Salvar pagamento"}
          </Button>
        </div>

        {payment ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={payment.acceptPix}
                  onChange={(event) =>
                    setPayment((prev) => ({
                      ...prev,
                      acceptPix: event.target.checked,
                    }))
                  }
                />
                Aceita PIX
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={payment.acceptCash}
                  onChange={(event) =>
                    setPayment((prev) => ({
                      ...prev,
                      acceptCash: event.target.checked,
                    }))
                  }
                />
                Aceita dinheiro
              </label>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <input
                  type="checkbox"
                  checked={payment.acceptCard}
                  onChange={(event) =>
                    setPayment((prev) => ({
                      ...prev,
                      acceptCard: event.target.checked,
                    }))
                  }
                />
                Aceita cartão
              </label>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Input
                label="Chave PIX"
                value={payment.pixKey || ""}
                onChange={(event) =>
                  setPayment((prev) => ({
                    ...prev,
                    pixKey: event.target.value,
                  }))
                }
              />
              <Input
                label="Nome no PIX"
                value={payment.pixName || ""}
                onChange={(event) =>
                  setPayment((prev) => ({
                    ...prev,
                    pixName: event.target.value,
                  }))
                }
              />
              <Input
                label="Banco PIX"
                value={payment.pixBank || ""}
                onChange={(event) =>
                  setPayment((prev) => ({
                    ...prev,
                    pixBank: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            Carregando pagamentos...
          </p>
        )}
      </div>
    </div>
  );
};

export default Settings;
