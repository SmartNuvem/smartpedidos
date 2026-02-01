import { useEffect, useState } from "react";
import Button from "./Button";

const isIosDevice = () =>
  /iphone|ipad|ipod/i.test(window.navigator.userAgent ?? "");

const isStandaloneDisplay = () => {
  if (window.matchMedia) {
    return window.matchMedia("(display-mode: standalone)").matches;
  }
  return window.navigator.standalone === true;
};

const WaiterInstallPrompt = () => {
  const [promptEvent, setPromptEvent] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(isStandaloneDisplay());
  }, []);

  useEffect(() => {
    const handler = (event) => {
      event.preventDefault();
      setPromptEvent(event);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (isInstalled) {
    return null;
  }

  if (isIosDevice()) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        <p className="font-semibold text-slate-700">Instalar no iPhone</p>
        <p className="mt-1">
          Toque em Compartilhar e selecione “Adicionar à Tela de Início”.
        </p>
      </div>
    );
  }

  if (!promptEvent) {
    return null;
  }

  const handleInstall = async () => {
    if (!promptEvent) {
      return;
    }
    await promptEvent.prompt();
    await promptEvent.userChoice.catch(() => null);
    setPromptEvent(null);
  };

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
      <p className="font-semibold">Instale o app do garçom</p>
      <p className="mt-1">
        Acesse o salão mais rápido adicionando o app à tela inicial.
      </p>
      <Button className="mt-3" onClick={handleInstall}>
        Instalar
      </Button>
    </div>
  );
};

export default WaiterInstallPrompt;
