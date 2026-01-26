import { NavLink, useNavigate } from "react-router-dom";
import { clearToken } from "../auth";

const Layout = ({ children }) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearToken();
    navigate("/login");
  };

  return (
    <div>
      <nav className="nav">
        <div className="nav-inner">
          <strong>SmartPedidos</strong>
          <div className="nav-links">
            <NavLink to="/">Dashboard</NavLink>
            <NavLink to="/pedidos">Pedidos</NavLink>
            <NavLink to="/configuracoes">Configurações</NavLink>
          </div>
          <button className="secondary" onClick={handleLogout} type="button">
            Sair
          </button>
        </div>
      </nav>
      <main className="container">{children}</main>
    </div>
  );
};

export default Layout;
