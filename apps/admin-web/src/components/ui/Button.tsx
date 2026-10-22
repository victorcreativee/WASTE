import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

const variants = {
  primary: "border-transparent bg-[var(--color-action)] text-white shadow-[var(--ui-shadow-xs)] hover:bg-[var(--color-action-hover)]",
  secondary: "border-[var(--color-border-strong)] bg-white text-slate-700 shadow-[var(--ui-shadow-xs)] hover:bg-slate-50",
  ghost: "border-transparent bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "border-transparent bg-[var(--color-danger)] text-white shadow-[var(--ui-shadow-xs)] hover:bg-red-800",
};

export function Button({
  children,
  isLoading,
  disabled,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-[var(--ui-radius)] border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    >
      {isLoading && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />}
      {isLoading ? "Please wait…" : children}
    </button>
  );
}
