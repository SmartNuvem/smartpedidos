import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken } from "./auth";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Orders from "./pages/Orders";
import OrderDetails from "./pages/OrderDetails";
import Settings from "./pages/Settings";

const RequireAuth = ({ children }) => {
  const location = useLocation();
  if (!getToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
};

const App = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route
      path="/"
      element={
        <RequireAuth>
          <Layout>
            <Dashboard />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/pedidos"
      element={
        <RequireAuth>
          <Layout>
            <Orders />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/pedidos/:id"
      element={
        <RequireAuth>
          <Layout>
            <OrderDetails />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/configuracoes"
      element={
        <RequireAuth>
          <Layout>
            <Settings />
          </Layout>
        </RequireAuth>
      }
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
