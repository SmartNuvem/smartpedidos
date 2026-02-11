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

type EvolutionFetchInstanceItem = {
  name?: string;
  instanceName?: string;
  status?: string;
  state?: string;
  connectionStatus?: string;
  owner?: string;
  profileName?: string;
  wuid?: string;
  instance?: {
    instanceName?: string;
    status?: string;
    state?: string;
    connectionStatus?: string;
    owner?: string;
    profileName?: string;
    wuid?: string;
  };
};

type EvolutionWebhookResponse = {
  webhook?: {
    url?: string;
    events?: string[];
  };
  url?: string;
  events?: string[];
  message?: string;
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

export const getInstanceStatus = async (instanceName: string) => {
  const tryConnectionState = async () => {
    const payload = await evolutionRequest(`/instance/connectionState/${instanceName}`, {
      method: "GET",
    });

    return {
      status: mapEvolutionStatus(payload),
      connectedPhone: extractConnectedPhone(payload),
    };
  };

  const tryFetchInstances = async () => {
    const payload = await evolutionRequest(`/instance/fetchInstances`, {
      method: "GET",
    });

    const list = Array.isArray(payload) ? (payload as EvolutionFetchInstanceItem[]) : [];
    const found = list.find((item) => {
      const name = item.name ?? item.instanceName ?? item.instance?.instanceName;
      return name === instanceName;
    });

    if (!found) {
      return {
        status: StoreBotStatus.DISCONNECTED,
        connectedPhone: null,
      };
    }

    return {
      status: mapEvolutionStatus({
        status: found.status,
        state: found.state,
        instance: {
          status: found.instance?.status ?? found.status,
          state: found.instance?.state ?? found.state,
          connectionStatus: found.instance?.connectionStatus ?? found.connectionStatus,
          owner: found.instance?.owner ?? found.owner,
          profileName: found.instance?.profileName ?? found.profileName,
          wuid: found.instance?.wuid ?? found.wuid,
        },
      }),
      connectedPhone:
        found.instance?.wuid ??
        found.instance?.owner ??
        found.instance?.profileName ??
        found.wuid ??
        found.owner ??
        found.profileName ??
        null,
    };
  };

  try {
    return await tryConnectionState();
  } catch {
    return tryFetchInstances();
  }
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

export const registerIncomingWebhook = async (instanceName: string) => {
  const webhookUrl = process.env.ACTIVEPIECES_INCOMING_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error("ACTIVEPIECES_INCOMING_WEBHOOK_URL não configurada.");
  }

  const payload = (await evolutionRequest(`/webhook/${instanceName}`, {
    method: "POST",
    body: JSON.stringify({
      url: webhookUrl,
      events: ["messages.upsert"],
    }),
  })) as EvolutionWebhookResponse;

  return {
    webhookUrl: payload.webhook?.url ?? payload.url ?? webhookUrl,
    events: payload.webhook?.events ?? payload.events ?? ["messages.upsert"],
    message: payload.message ?? null,
  };
};
