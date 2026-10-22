// Shared types and labels for Waste Management SaaS subscriptions (Module 12).

export type SubStatus="trialing"|"active"|"past_due"|"suspended"|"cancelled"|"complimentary";
export type Plan={id:string;code:string;name:string;description:string;organization_type:string;monthly_fee_ugx:number;annual_fee_ugx:number;max_vehicles:number|null;max_users:number|null;trial_days:number;is_public:boolean;is_active:boolean;feature_codes:string[]};
export type Invoice={id:string;invoice_number:string;organization_id:string;organization_name:string;plan_name:string;kind:"period"|"proration";billing_cycle:string;period_start:string;period_end:string;amount_ugx:number;status:"open"|"payment_submitted"|"paid"|"void";issued_at:string;due_on:string;payment_reference:string|null;paid_on:string|null;void_reason:string|null;overdue:boolean};
export type Subscription={organization_id:string;organization_name:string;organization_type:string;status:SubStatus;billing_cycle:"monthly"|"annual";plan_code:string;plan_name:string;monthly_fee_ugx:number;annual_fee_ugx:number;max_vehicles:number|null;max_users:number|null;price_ugx:number;trial_ends_at:string|null;trial_days_left:number|null;period_start:string;period_end:string;cancel_at_period_end:boolean;pending_plan_code:string|null;pending_plan_name:string|null;pending_billing_cycle:string|null;status_reason:string|null};
export type SubscriptionData={subscription:Subscription|null;usage:{vehicles:number;users:number};invoices:Invoice[];plans:Plan[];rules?:{daysToPay:number;suspendAfterDays:number}};

export const STATUS:Record<SubStatus,{label:string;className:string}>={
  trialing:{label:"Free trial",className:"status status-pending normal-case"},
  active:{label:"Active",className:"status status-active normal-case"},
  past_due:{label:"Payment overdue",className:"status status-failed normal-case"},
  suspended:{label:"Suspended",className:"status status-failed normal-case"},
  cancelled:{label:"Ended",className:"status normal-case"},
  complimentary:{label:"Complimentary",className:"status status-active normal-case"},
};
export const INVOICE_STATUS:Record<Invoice["status"],{label:string;className:string}>={
  open:{label:"Unpaid",className:"status status-pending normal-case"},
  payment_submitted:{label:"Payment to confirm",className:"status status-pending normal-case"},
  paid:{label:"Paid",className:"status status-active normal-case"},
  void:{label:"Void",className:"status normal-case"},
};
export const ugx=(n:number|string|null|undefined)=>n===null||n===undefined?"—":`UGX ${Number(n).toLocaleString("en-GB")}`;
export const day=(iso:string|null)=>iso?new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
export const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
export const limit=(n:number|null)=>n===null?"Unlimited":n.toLocaleString("en-GB");
