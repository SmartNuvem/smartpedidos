const Input = ({ label, error, className = "", ...props }) => (
  <label className="grid gap-2 text-sm font-medium text-slate-700">
    {label}
    <input
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200 ${className}`}
      {...props}
    />
    {error ? <span className="text-xs text-rose-600">{error}</span> : null}
  </label>
);

export default Input;
