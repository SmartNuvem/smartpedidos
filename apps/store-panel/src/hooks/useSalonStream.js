import { useEffect, useRef, useState } from "react";

const buildStreamUrl = () => "/api/store/salon/stream";

const useSalonStream = ({ onTablesUpdated, onConnectionChange } = {}) => {
  const [streamStatus, setStreamStatus] = useState("connecting");
  const callbacksRef = useRef({ onTablesUpdated, onConnectionChange });
  const sourceRef = useRef(null);

  useEffect(() => {
    callbacksRef.current = { onTablesUpdated, onConnectionChange };
  }, [onTablesUpdated, onConnectionChange]);

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

    const handleEvent = (event) => {
      try {
        const payload = event?.data ? JSON.parse(event.data) : event;
        callbacksRef.current.onTablesUpdated?.(payload);
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener("tables_updated", handleEvent);
    source.onmessage = handleEvent;

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

export default useSalonStream;
