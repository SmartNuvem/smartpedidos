import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api";
import { getAdminToken } from "./auth";
import AdminLayout from "./components/AdminLayout";
import Layout from "./components/Layout";
import AdminLogin from "./pages/AdminLogin";
import AdminStoreDetails from "./pages/AdminStoreDetails";
import AdminStores from "./pages/AdminStores";
import Dashboard from "./pages/Dashboard";
import Billing from "./pages/Billing";
import Login from "./pages/Login";
import Orders from "./pages/Orders";
import OrderDetails from "./pages/OrderDetails";
import Salon from "./pages/Salon";
import SalonTable from "./pages/SalonTable";
import Settings from "./pages/Settings";
import BotSettings from "./pages/BotSettings";
import Categories from "./pages/Categories";
import Products from "./pages/Products";
import PublicOrder from "./pages/PublicOrder";
import WaiterLogin from "./pages/WaiterLogin";
import WaiterStart from "./pages/WaiterStart";
import WaiterTable from "./pages/WaiterTable";
import WaiterTables from "./pages/WaiterTables";

const RequireAuth = ({ children }) => {
  const location = useLocation();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    let isActive = true;
    const checkSession = async () => {
      try {
        await api.getStore();
        if (isActive) {
          setStatus("authenticated");
        }
      } catch {
        if (isActive) {
          setStatus("unauthenticated");
        }
      }
    };

    checkSession();

    return () => {
      isActive = false;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <span className="text-sm text-slate-500">Carregando...</span>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

const RequireAdmin = ({ children }) => {
  const location = useLocation();
  if (!getAdminToken()) {
    return <Navigate to="/admin/login" state={{ from: location }} replace />;
  }
  return children;
};

const App = () => (
  <Routes>
    <Route path="/p/:slug" element={<PublicOrder />} />
    <Route path="/s" element={<WaiterStart />} />
    <Route path="/s/:slug/garcom" element={<WaiterLogin />} />
    <Route path="/s/:slug/garcom/mesas" element={<WaiterTables />} />
    <Route path="/s/:slug/garcom/mesa/:id" element={<WaiterTable />} />
    <Route path="/login" element={<Login />} />
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route
      path="/admin/stores/:id"
      element={
        <RequireAdmin>
          <AdminLayout>
            <AdminStoreDetails />
          </AdminLayout>
        </RequireAdmin>
      }
    />
    <Route
      path="/admin/stores"
      element={
        <RequireAdmin>
          <AdminLayout>
            <AdminStores />
          </AdminLayout>
        </RequireAdmin>
      }
    />
    <Route path="/admin" element={<Navigate to="/admin/stores" replace />} />
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
      path="/billing"
      element={
        <RequireAuth>
          <Layout>
            <Billing />
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
    <Route
      path="/settings/bot-whatsapp"
      element={
        <RequireAuth>
          <Layout>
            <BotSettings />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/store/salon"
      element={
        <RequireAuth>
          <Layout>
            <Salon />
          </Layout>
        </RequireAuth>
      }
    />
    <Route
      path="/store/salon/tables/:id"
      element={
        <RequireAuth>
          <Layout>
            <SalonTable />
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
