import { useEffect, useRef } from "react";
const buildStreamUrl = () => "/api/store/orders/stream";

const useOrdersStream = ({
  onOrderCreated,
  onOrderUpdated,
  onConnectionChange,
} = {}) => {
  const attemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const sourceRef = useRef(null);

  useEffect(() => {
    if (!window.EventSource) {
      onConnectionChange?.("unsupported");
      return undefined;
    }

    let isActive = true;
    const connect = () => {
      if (!isActive) {
        return;
      }

      if (reconnectTimeoutRef.current) {
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
        attemptRef.current = 0;
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
        attemptRef.current += 1;
        const baseDelay = Math.min(30000, 2000 * attemptRef.current);
        const delay = baseDelay + Math.floor(Math.random() * 1000);
        reconnectTimeoutRef.current = window.setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, delay);
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
