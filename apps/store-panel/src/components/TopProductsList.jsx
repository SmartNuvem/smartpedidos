import { formatCurrency } from "../api";

const TopProductsList = ({ data = [] }) => {
  return (
    <div className="space-y-3">
      {data.map((item, index) => (
        <div
          key={`${item.productId}-${index}`}
          className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
        >
          <div>
            <p className="text-sm font-medium text-slate-900">{item.name}</p>
            <p className="text-xs text-slate-500">{item.qty} vendidos</p>
          </div>
          <p className="text-sm font-semibold text-slate-700">
            {formatCurrency((item.revenueCents ?? 0) / 100)}
          </p>
        </div>
      ))}
    </div>
  );
};

export default TopProductsList;
