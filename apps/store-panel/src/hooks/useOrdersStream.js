import { useEffect, useRef, useState } from "react";
const buildStreamUrl = () => "/api/store/orders/stream";

const useOrdersStream = ({
  onOrderCreated,
  onOrderUpdated,
  onConnectionChange,
} = {}) => {
  const [streamStatus, setStreamStatus] = useState("connecting");
  const callbacksRef = useRef({
    onOrderCreated,
    onOrderUpdated,
    onConnectionChange,
  });
  const sourceRef = useRef(null);

  useEffect(() => {
    callbacksRef.current = {
      onOrderCreated,
      onOrderUpdated,
      onConnectionChange,
    };
  }, [onOrderCreated, onOrderUpdated, onConnectionChange]);

  useEffect(() => {
    if (!window.EventSource) {
      setStreamStatus("error");
      callbacksRef.current.onConnectionChange?.("unsupported");
      return undefined;
    }

    setStreamStatus("connecting");
    callbacksRef.current.onConnectionChange?.("connecting");
    const source = new EventSource(buildStreamUrl());
    sourceRef.current = source;

    const dispatchPayload = (payload, typeOverride) => {
      if (!payload) {
        return;
      }
      const resolvedType = typeOverride || payload.type;
      if (resolvedType === "order.created") {
        callbacksRef.current.onOrderCreated?.(payload);
      }
      if (resolvedType === "order.updated") {
        callbacksRef.current.onOrderUpdated?.(payload);
      }
    };

    const handleEvent = (event, typeOverride) => {
      try {
        const payload = event?.data ? JSON.parse(event.data) : event;
        dispatchPayload(payload, typeOverride);
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener("order.created", (event) =>
      handleEvent(event, "order.created")
    );

    source.addEventListener("order.updated", (event) =>
      handleEvent(event, "order.updated")
    );

    source.onmessage = (event) => handleEvent(event, undefined);

    source.onopen = () => {
      setStreamStatus("open");
      callbacksRef.current.onConnectionChange?.("open");
    };

    source.onerror = () => {
      setStreamStatus("error");
      callbacksRef.current.onConnectionChange?.("error");
    };

    return () => {
      setStreamStatus("closed");
      callbacksRef.current.onConnectionChange?.("closed");
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, []);

  return { streamStatus };
};

export default useOrdersStream;
