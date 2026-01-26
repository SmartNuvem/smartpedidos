import { useEffect, useRef } from "react";
import { API_URL } from "../api";

const buildStreamUrl = () => `${API_URL}/store/orders/stream`;

const useOrdersStream = ({
  onOrderCreated,
  onOrderUpdated,
  onConnectionChange,
} = {}) => {
  const attemptRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    if (!window.EventSource) {
      onConnectionChange?.("unsupported");
      return undefined;
    }

    let isActive = true;
    let source;

    const connect = () => {
      if (!isActive) {
        return;
      }

      source = new EventSource(buildStreamUrl());

      source.addEventListener("order.created", (event) => {
        onOrderCreated?.(event);
      });

      source.addEventListener("order.updated", (event) => {
        onOrderUpdated?.(event);
      });

      source.onopen = () => {
        attemptRef.current = 0;
        onConnectionChange?.("open");
      };

      source.onerror = () => {
        source?.close();
        onConnectionChange?.("error");
        if (!isActive) {
          return;
        }
        attemptRef.current += 1;
        const delay = Math.min(30000, 2000 * attemptRef.current);
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
      source?.close();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [onConnectionChange, onOrderCreated, onOrderUpdated]);
};

export default useOrdersStream;
