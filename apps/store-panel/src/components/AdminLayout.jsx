import { NavLink, useNavigate } from "react-router-dom";
import { clearAdminToken } from "../auth";
import AppFooter from "./AppFooter";
import Button from "./Button";

const linkClass = ({ isActive }) =>
  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive
      ? "bg-emerald-50 text-emerald-700"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

const AdminLayout = ({ children }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearAdminToken();
    navigate("/admin/login");
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="flex">
        <aside className="hidden min-h-screen w-64 flex-col gap-6 border-r border-slate-200 bg-white px-4 py-6 lg:flex">
          <div className="px-2 text-lg font-bold text-slate-900">
            SmartPedido Admin
          </div>
          <nav className="flex flex-col gap-1">
            <NavLink to="/admin/stores" className={linkClass}>
              Restaurantes
            </NavLink>
          </nav>
          <div className="mt-auto px-2">
            <Button variant="secondary" className="w-full" onClick={handleLogout}>
              Sair
            </Button>
          </div>
        </aside>

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-4 lg:px-8">
            <div>
              <p className="text-sm text-slate-500">Painel administrativo</p>
              <h1 className="text-lg font-semibold text-slate-900">
                Gestão de Restaurantes
              </h1>
            </div>
            <div className="lg:hidden">
              <Button variant="secondary" onClick={handleLogout}>
                Sair
              </Button>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 lg:px-8">
            <div className="container-app space-y-6">{children}</div>
          </main>
          <AppFooter />
        </div>
      </div>
    </div>
  );
};

export default AdminLayout;
