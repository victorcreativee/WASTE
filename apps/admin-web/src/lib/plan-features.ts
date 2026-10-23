// Names for the feature codes on waste-collection plans, shared by the public pricing page and platform administration.
export const WASTE_FEATURES = [
  ["core_operations", "Today’s operations and trips"], ["service_areas", "Service areas and routes"], ["fleet", "Fleet and drivers"],
  ["tonnage", "Daily tonnage"], ["service_issues", "Service issues"], ["customers", "Customer management"],
  ["contracts", "Contracts and service levels"], ["billing", "Income and billing"], ["finance", "Payroll and accounts payable"],
  ["inventory", "Inventory"], ["procurement", "Procurement"], ["reports", "Operational reports"], ["compliance", "KCCA compliance"],
  ["access", "Access and permissions"],
] as const;

/** Where a plan chosen on the pricing page is remembered until the company reaches the plan step of signing up. */
export const SIGNUP_PLAN_KEY = "kwms.signup.plan";

/** The id of the plan remembered from the pricing page, if it is one of these plans. */
export function rememberedPlanId(plans: { id: string; code: string }[]) {
  try {
    const code = localStorage.getItem(SIGNUP_PLAN_KEY);
    return plans.find((plan) => plan.code === code)?.id ?? "";
  } catch {
    return "";
  }
}
