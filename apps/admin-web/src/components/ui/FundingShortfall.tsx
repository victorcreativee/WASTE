type Props = {
  id?: string;
  amount: number;
  available: number;
  action: "approval" | "payment";
};

const money = (value: number) => `UGX ${value.toLocaleString("en-UG", { maximumFractionDigits: 0 })}`;

/** Visible feedback also works on touch devices, where button tooltips do not. */
export function FundingShortfall({ id, amount, available, action }: Props) {
  if (amount <= available) return null;
  return (
    <p id={id} className="mt-2 text-xs leading-5 text-red-700">
      {action === "approval" ? "Approval blocked" : "Payment blocked"}: needs {money(amount)};
      {" "}{action === "approval" ? "available to commit" : "cash balance"} is {money(available)}.
      {" "}Shortfall: {money(amount - available)}.
    </p>
  );
}
