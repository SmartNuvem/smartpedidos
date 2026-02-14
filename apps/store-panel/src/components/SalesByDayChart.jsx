import { formatCurrency } from "../api";

const formatDayLabel = (dateInput) => {
  const date = new Date(`${dateInput}T00:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
};

const SalesByDayChart = ({ data = [] }) => {
  const maxRevenue = data.reduce(
    (max, point) => Math.max(max, point?.revenueCents ?? 0),
    0
  );

  return (
    <div className="space-y-3">
      {data.map((point) => {
        const revenueCents = point?.revenueCents ?? 0;
        const percent = maxRevenue > 0 ? Math.max((revenueCents / maxRevenue) * 100, 2) : 2;
        return (
          <div key={point.date}>
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>{formatDayLabel(point.date)}</span>
              <span>
                {formatCurrency(revenueCents / 100)} • {point.orders ?? 0} pedidos
              </span>
            </div>
            <div className="h-3 rounded-full bg-slate-100">
              <div className="h-3 rounded-full bg-blue-500" style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SalesByDayChart;
