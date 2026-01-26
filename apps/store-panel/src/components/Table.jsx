const Table = ({ children, className = "" }) => (
  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <table className={`min-w-full divide-y divide-slate-200 text-sm ${className}`}>
      {children}
    </table>
  </div>
);

export default Table;
