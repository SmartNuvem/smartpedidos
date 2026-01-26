const Select = ({ label, error, className = "", children, ...props }) => (
  <label className="grid gap-2 text-sm font-medium text-slate-700">
    {label}
    <select
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${className}`}
      {...props}
    >
      {children}
    </select>
    {error ? <span className="text-xs text-rose-600">{error}</span> : null}
  </label>
);

export default Select;
