import { useEffect, useRef } from "react";

const Modal = ({
  open,
  title,
  children,
  footer,
  onClose,
  containerClassName = "",
  headerClassName = "",
  bodyClassName = "mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]",
  footerClassName = "",
}) => {
  const previousOverflow = useRef("");

  useEffect(() => {
    if (!open) return undefined;
    previousOverflow.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previousOverflow.current;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
        role="presentation"
      />
      <div
        className={`relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white p-6 shadow-xl ${containerClassName}`.trim()}
      >
        <div
          className={`flex shrink-0 items-start justify-between gap-4 ${headerClassName}`.trim()}
        >
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          </div>
          <button
            className="text-slate-500 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
        <div
          className={bodyClassName}
          onWheelCapture={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
        >
          {children}
        </div>
        {footer ? (
          <div
            className={`mt-6 flex shrink-0 justify-end gap-3 ${footerClassName}`.trim()}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Modal;
