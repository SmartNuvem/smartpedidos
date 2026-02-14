import { Component } from "react";
import { readPendingPublicOrder } from "../publicOrderPending";

class PublicRoutesErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, hasPendingOrder: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error("[PublicRoutesErrorBoundary]", error);
    this.syncPendingOrderState();
  }

  syncPendingOrderState = () => {
    const pending = readPendingPublicOrder();
    this.setState({ hasPendingOrder: Boolean(pending) });
  };

  handleReload = () => {
    window.location.reload();
  };

  handleResend = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Ops! Tivemos um problema.</h1>
          <p className="mt-2 text-sm text-slate-600">
            Ocorreu um erro inesperado. Você pode recarregar a página para continuar.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
            >
              Recarregar
            </button>
            {this.state.hasPendingOrder ? (
              <button
                type="button"
                onClick={this.handleResend}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800"
              >
                Reenviar pedido
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}


export default PublicRoutesErrorBoundary;
