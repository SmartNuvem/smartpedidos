import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { getToken } from "./auth";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Orders from "./pages/Orders";
import OrderDetails from "./pages/OrderDetails";
import Settings from "./pages/Settings";
import Categories from "./pages/Categories";
import Products from "./pages/Products";

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
      path="/orders"
      element={
        <RequireAuth>
          <Layout>
            <Orders />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/orders/:id"
      element={
        <RequireAuth>
          <Layout>
            <OrderDetails />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/categories"
      element={
        <RequireAuth>
          <Layout>
            <Categories />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/products"
      element={
        <RequireAuth>
          <Layout>
            <Products />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/settings"
      element={
        <RequireAuth>
          <Layout>
            <Settings />
          </Layout>
        </RequireAuth>
      }
    />
    <Route path="/pedidos" element={<Navigate to="/orders" replace />} />
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
      element={<Navigate to="/settings" replace />}
    />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
