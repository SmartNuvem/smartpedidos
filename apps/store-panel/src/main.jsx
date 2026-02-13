import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

const WAITER_ROUTE_PATTERNS = [
  /^\/s(?:\/|$)/i,
  /^\/g(?:\/|$)/i,
  /^\/garcom(?:\/|$)/i,
  /^\/waiter(?:\/|$)/i,
];

const isWaiterRoute = (pathname) =>
  WAITER_ROUTE_PATTERNS.some((pattern) => pattern.test(pathname));

const upsertManifestLink = () => {
  const head = document.head;
  if (!head) return;

  const href = "/manifest.webmanifest?v=2";
  const existing = document.querySelector('link[rel="manifest"]');

  if (existing) {
    existing.setAttribute("href", href);
    return;
  }

  const link = document.createElement("link");
  link.setAttribute("rel", "manifest");
  link.setAttribute("href", href);
  head.appendChild(link);
};

const removeManifestLink = () => {
  document
    .querySelectorAll('link[rel="manifest"]')
    .forEach((manifestLink) => manifestLink.remove());
};

const unregisterAllServiceWorkers = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
};

const bootstrapPwa = async () => {
  const waiterRoute = isWaiterRoute(window.location.pathname);

  if (!waiterRoute) {
    removeManifestLink();
    await unregisterAllServiceWorkers();
    return;
  }

  upsertManifestLink();
  registerSW({ immediate: true });
};

bootstrapPwa().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>
  );
});
