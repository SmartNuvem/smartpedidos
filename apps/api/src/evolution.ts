import { StoreBotStatus } from "@prisma/client";

type EvolutionInstanceResponse = {
  instance?: {
    instanceName?: string;
    status?: string;
    state?: string;
    connectionStatus?: string;
    profileName?: string;
    owner?: string;
    wuid?: string;
  };
  qrcode?: {
    code?: string;
    base64?: string;
  };
  base64?: string;
  qr?: string;
  status?: string;
  state?: string;
  connectedPhone?: string;
};

const getConfig = () => {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  return { baseUrl, apiKey };
};

const evolutionRequest = async (
  path: string,
  options: RequestInit = {}
): Promise<any> => {
  const { baseUrl, apiKey } = getConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("Evolution API não configurada.");
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Evolution API error: ${response.status} ${body}`);
  }

  return response
    .json()
    .catch(() => ({}) as EvolutionInstanceResponse) as Promise<EvolutionInstanceResponse>;
};

const mapEvolutionStatus = (payload: EvolutionInstanceResponse): StoreBotStatus => {
  const rawStatus =
    payload.instance?.status ??
    payload.instance?.connectionStatus ??
    payload.instance?.state ??
    payload.status ??
    payload.state ??
    "";
  const normalized = rawStatus.toString().toUpperCase();
  if (
    normalized.includes("OPEN") ||
    normalized.includes("CONNECTED") ||
    normalized.includes("ONLINE")
  ) {
    return StoreBotStatus.CONNECTED;
  }
  if (
    normalized.includes("QRCODE") ||
    normalized.includes("QR") ||
    normalized.includes("PAIRING") ||
    normalized.includes("CONNECTING")
  ) {
    return StoreBotStatus.WAITING_QR;
  }
  return StoreBotStatus.DISCONNECTED;
};

const extractConnectedPhone = (payload: EvolutionInstanceResponse) => {
  return (
    payload.connectedPhone ??
    payload.instance?.wuid ??
    payload.instance?.owner ??
    payload.instance?.profileName ??
    null
  );
};

export const ensureInstance = async (instanceName: string) => {
  try {
    const found = await evolutionRequest(`/instance/fetchInstances`);
    const list = Array.isArray(found) ? found : [];
    const exists = list.some((item) => {
      const name =
        (item?.name as string | undefined) ??
        (item?.instance?.instanceName as string | undefined) ??
        (item?.instanceName as string | undefined);
      return name === instanceName;
    });

    if (!exists) {
      await evolutionRequest("/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          integration: "WHATSAPP-BAILEYS",
          qrcode: true,
        }),
      });
    }
  } catch {
    await evolutionRequest("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName,
        integration: "WHATSAPP-BAILEYS",
        qrcode: true,
      }),
    });
  }
};

export const getQr = async (instanceName: string) => {
  const payload = await evolutionRequest(`/instance/connect/${instanceName}`, {
    method: "GET",
  });

  const qrBase64 =
    payload.qrcode?.base64 ?? payload.qrcode?.code ?? payload.base64 ?? payload.qr ?? null;

  return {
    qrBase64,
    status: mapEvolutionStatus(payload),
    connectedPhone: extractConnectedPhone(payload),
  };
};

export const disconnect = async (instanceName: string) => {
  const payload = await evolutionRequest(`/instance/logout/${instanceName}`, {
    method: "DELETE",
  });

  return {
    status: mapEvolutionStatus(payload),
    connectedPhone: extractConnectedPhone(payload),
  };
};
