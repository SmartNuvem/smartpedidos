const baseStyles =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

const variants = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  secondary: "bg-slate-200 text-slate-900 hover:bg-slate-300",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

const Button = ({ variant = "primary", className = "", ...props }) => (
  <button
    className={`${baseStyles} ${variants[variant]} ${className}`}
    type="button"
    {...props}
  />
);

export default Button;
