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
  id?: string;
  instanceId?: string;
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
    enabled?: boolean;
  };
  url?: string;
  events?: string[];
  enabled?: boolean;
  message?: string;
};

type EvolutionManagerWebhookPayload = {
  url: string;
  headers: null;
  enabled: true;
  events: ["MESSAGES_UPSERT"];
  webhookByEvents: false;
  webhookBase64: false;
};

type EvolutionManagerWebhookResult = {
  webhookUrl: string;
  webhookEnabled: boolean;
  webhookEvents: string[];
  statusCode: number | null;
  instanceId: string;
};

class EvolutionApiError extends Error {
  statusCode: number;
  responseBody: string;

  constructor(statusCode: number, responseBody: string) {
    super(`Evolution API error: ${statusCode} ${responseBody}`);
    this.name = "EvolutionApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export const isEvolutionApiError = (error: unknown): error is EvolutionApiError =>
  error instanceof EvolutionApiError;

const getConfig = () => {
  const baseUrl = process.env.EVOLUTION_BASE_URL?.trim();
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();
  return { baseUrl, apiKey };
};

const evolutionRequest = async (
  path: string,
  options: (RequestInit & { parseJson?: boolean }) = {}
): Promise<any> => {
  const { baseUrl, apiKey } = getConfig();
  if (!baseUrl || !apiKey) {
    throw new Error("Evolution API não configurada.");
  }

  const { parseJson = true, ...requestOptions } = options;

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      ...(requestOptions.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new EvolutionApiError(response.status, body);
  }

  if (!parseJson) {
    return response;
  }

  return response
    .json()
    .catch(() => ({}) as EvolutionInstanceResponse) as Promise<EvolutionInstanceResponse>;
};


const fetchInstances = async () => {
  const payload = await evolutionRequest(`/instance/fetchInstances`, {
    method: "GET",
  });

  return Array.isArray(payload) ? (payload as EvolutionFetchInstanceItem[]) : [];
};

const resolveInstanceIdByName = async (instanceName: string) => {
  const list = await fetchInstances();
  const found = list.find((item) => {
    const name = item.name ?? item.instanceName ?? item.instance?.instanceName;
    return name === instanceName;
  });

  if (!found) {
    throw new Error(`Instância ${instanceName} não encontrada na Evolution.`);
  }

  const instanceId = found.id ?? found.instanceId;
  if (!instanceId) {
    throw new Error(`Instância ${instanceName} encontrada sem instanceId.`);
  }

  return instanceId;
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
    const list = await fetchInstances();
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
    const list = await fetchInstances();
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

export const registerIncomingWebhook = async (
  instanceName: string
): Promise<EvolutionManagerWebhookResult> => {
  const webhookUrl = process.env.ACTIVEPIECES_INCOMING_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error("ACTIVEPIECES_INCOMING_WEBHOOK_URL não configurada.");
  }

  const instanceId = await resolveInstanceIdByName(instanceName);
  const managerPayload: EvolutionManagerWebhookPayload = {
    url: webhookUrl,
    headers: null,
    enabled: true,
    events: ["MESSAGES_UPSERT"],
    webhookByEvents: false,
    webhookBase64: false,
  };

  let response: Response;
  try {
    response = await evolutionRequest(`/manager/instance/${instanceId}/webhook`, {
      method: "PUT",
      body: JSON.stringify(managerPayload),
      parseJson: false,
    });
  } catch {
    response = await evolutionRequest(`/manager/instance/${instanceId}/webhook`, {
      method: "POST",
      body: JSON.stringify(managerPayload),
      parseJson: false,
    });
  }

  const statusCode = response.status;
  const bodyText = await response.text().catch(() => "");
  let payload: EvolutionWebhookResponse = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText) as EvolutionWebhookResponse;
    } catch {
      payload = {};
    }
  }

  return {
    webhookUrl: payload.webhook?.url ?? payload.url ?? webhookUrl,
    webhookEnabled: payload.webhook?.enabled ?? payload.enabled ?? true,
    webhookEvents: payload.webhook?.events ?? payload.events ?? ["MESSAGES_UPSERT"],
    statusCode,
    instanceId,
  };
};
