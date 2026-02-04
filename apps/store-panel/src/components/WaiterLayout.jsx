import AppFooter from "./AppFooter";
import Button from "./Button";

const WaiterLayout = ({ title, subtitle, onLogout, actions, children }) => (
  <div className="flex min-h-screen flex-col bg-slate-50 px-4 py-6">
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-400">
              SmartPedidos Garçom
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
            {subtitle ? (
              <p className="text-sm text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {onLogout ? (
              <Button variant="secondary" onClick={onLogout}>
                Sair
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {children}
    </div>
    <AppFooter />
  </div>
);

export default WaiterLayout;
