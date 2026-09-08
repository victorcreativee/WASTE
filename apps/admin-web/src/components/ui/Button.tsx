import { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
};

export function Button({
  children,
  isLoading,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className="min-h-10 border border-transparent bg-[var(--color-action)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--color-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-action)] disabled:cursor-not-allowed disabled:opacity-50"
      {...props}
    >
      {isLoading ? "Please wait..." : children}
    </button>
  );
}
