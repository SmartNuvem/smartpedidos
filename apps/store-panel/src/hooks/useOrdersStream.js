import { useEffect, useRef } from "react";
const buildStreamUrl = () => "/api/store/orders/stream";

const useOrdersStream = ({
  onOrderCreated,
  onOrderUpdated,
  onConnectionChange,
} = {}) => {
  const reconnectTimeoutRef = useRef(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!window.EventSource) {
      onConnectionChange?.("unsupported");
      return undefined;
    }

    let isActive = true;
    const reconnectDelayMs = 10000;
    const connect = () => {
      if (!isActive) {
        return;
      }

      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }

      onConnectionChange?.("connecting");
      const source = new EventSource(buildStreamUrl(), { withCredentials: true });
      sourceRef.current = source;

      source.addEventListener("order.created", (event) => {
        onOrderCreated?.(event);
      });

      source.addEventListener("order.updated", (event) => {
        onOrderUpdated?.(event);
      });

      source.onopen = () => {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        onConnectionChange?.("open");
      };

      source.onerror = () => {
        source.close();
        onConnectionChange?.("error");
        if (!isActive) {
          return;
        }
        if (reconnectTimeoutRef.current) {
          return;
        }
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, reconnectDelayMs);
      };
    };

    connect();

    return () => {
      isActive = false;
      onConnectionChange?.("closed");
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [onConnectionChange, onOrderCreated, onOrderUpdated]);
};

export default useOrdersStream;
