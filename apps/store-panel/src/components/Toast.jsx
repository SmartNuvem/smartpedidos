import { useEffect } from "react";

const variants = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  error: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

const Toast = ({ message, variant = "info", onClose }) => {
  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => {
      onClose?.();
    }, 3500);
    return () => clearTimeout(timer);
  }, [message, onClose]);

  if (!message) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg ${
          variants[variant]
        }`}
      >
        <span>{message}</span>
        <button
          className="text-sm font-semibold"
          onClick={onClose}
          type="button"
        >
          Fechar
        </button>
      </div>
    </div>
  );
};

export default Toast;
