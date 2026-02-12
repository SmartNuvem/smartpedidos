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
    webhookByEvents?: boolean;
    webhookBase64?: boolean;
    headers?: Record<string, string>;
  };
  url?: string;
  events?: string[];
  enabled?: boolean;
  webhookByEvents?: boolean;
  webhookBase64?: boolean;
  headers?: Record<string, string>;
  message?: string;
};

type EvolutionWebhookSetPayload = {
  webhook: {
    url: string;
    enabled: true;
    events: ["MESSAGES_UPSERT"];
    webhookByEvents: false;
    webhookBase64: false;
    headers: Record<string, string>;
  };
};

type EvolutionWebhookSyncResult = {
  webhookUrl: string;
  webhookEnabled: boolean;
  webhookEvents: string[];
  statusCode: number | null;
  responseBody: string | null;
  applied: boolean;
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
  const endpoints = ["/manager/instance/fetchInstances", "/instance/fetchInstances"];
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const payload = await evolutionRequest(endpoint, {
        method: "GET",
      });

      return Array.isArray(payload) ? (payload as EvolutionFetchInstanceItem[]) : [];
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha ao listar instâncias na Evolution.");
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

export const syncIncomingWebhook = async (
  instanceName: string
): Promise<EvolutionWebhookSyncResult> => {
  const webhookUrl = process.env.ACTIVEPIECES_INCOMING_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    throw new Error("ACTIVEPIECES_INCOMING_WEBHOOK_URL não configurada.");
  }

  const expectedEvents = ["MESSAGES_UPSERT"];

  const findResponse = await evolutionRequest(`/webhook/find/${instanceName}`, {
    method: "GET",
  });

  const currentWebhookUrl = findResponse.webhook?.url ?? findResponse.url ?? null;
  const currentWebhookEnabled = findResponse.webhook?.enabled ?? findResponse.enabled ?? false;
  const currentWebhookEvents = findResponse.webhook?.events ?? findResponse.events ?? [];
  const shouldApplyWebhook =
    currentWebhookUrl !== webhookUrl ||
    currentWebhookEnabled !== true ||
    currentWebhookEvents.length !== 1 ||
    currentWebhookEvents[0] !== expectedEvents[0];

  if (!shouldApplyWebhook) {
    return {
      webhookUrl,
      webhookEnabled: true,
      webhookEvents: expectedEvents,
      statusCode: null,
      responseBody: null,
      applied: false,
    };
  }

  const setPayload: EvolutionWebhookSetPayload = {
    webhook: {
      url: webhookUrl,
      enabled: true,
      events: ["MESSAGES_UPSERT"],
      webhookByEvents: false,
      webhookBase64: false,
      headers: {},
    },
  };

  const response = await evolutionRequest(`/webhook/set/${instanceName}`, {
    method: "POST",
    body: JSON.stringify(setPayload),
    parseJson: false,
  });

  const statusCode = response.status;
  const bodyText = await response.text().catch(() => "");
  let responsePayload: EvolutionWebhookResponse = {};
  if (bodyText) {
    try {
      responsePayload = JSON.parse(bodyText) as EvolutionWebhookResponse;
    } catch {
      responsePayload = {};
    }
  }

  return {
    webhookUrl: responsePayload.webhook?.url ?? responsePayload.url ?? webhookUrl,
    webhookEnabled: responsePayload.webhook?.enabled ?? responsePayload.enabled ?? true,
    webhookEvents: responsePayload.webhook?.events ?? responsePayload.events ?? expectedEvents,
    statusCode,
    responseBody: bodyText || null,
    applied: true,
  };
};
