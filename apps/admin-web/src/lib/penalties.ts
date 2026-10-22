// Shared types and labels for fines and penalties (Module 10).

export type PenaltyStatus="issued"|"appealed"|"payment_submitted"|"paid"|"waived";
export type ScheduleItem={code:string;title:string;description:string;amount_ugx:number;repeat_amount_ugx:number;is_active:boolean};
export type Notice={id:string;notice_number:string;organization_id:string;organization_name:string;schedule_code:string;offence:string;offence_number:number;original_amount_ugx:number;amount_ugx:number;grounds:string;compliance_case_id:string|null;case_number:string|null;dumping_site_id:string|null;site_number:string|null;return_period:string|null;status:PenaltyStatus;issued_at:string;appeal_deadline:string;due_on:string;payment_reference:string|null;paid_on:string|null;payment_submitted_at:string|null;payment_confirmed_at:string|null;waived_reason:string|null;escalated_at:string|null;overdue:boolean;appealed_before:boolean};
export type NoticeDetail=Notice&{appeal:{grounds:string;submitted_at:string;submitted_by_name:string;decision:string|null;decision_note:string|null;decided_at:string|null}|null;history:Array<{action:string;note:string|null;created_at:string;actor_name:string|null}>;can:{appeal:boolean;escalate:boolean;escalate_reason:string|null}};

export const STATUS:Record<PenaltyStatus,{label:string;className:string}>={
  issued:{label:"Unpaid",className:"status status-pending normal-case"},
  appealed:{label:"Under appeal",className:"status status-pending normal-case"},
  payment_submitted:{label:"Payment to confirm",className:"status status-pending normal-case"},
  paid:{label:"Paid",className:"status status-active normal-case"},
  waived:{label:"Withdrawn",className:"status normal-case"},
};
export const ACTION:Record<string,string>={issued:"Notice issued",appealed:"Appeal filed",appeal_upheld:"Appeal not allowed",appeal_reduced:"Penalty reduced on appeal",appeal_withdrawn:"Withdrawn on appeal",payment_submitted:"Payment submitted",payment_rejected:"Payment not found",paid:"Payment confirmed",waived:"Withdrawn by KCCA",escalated:"Permit suspended"};
export const ugx=(amount:number|string|null|undefined)=>amount===null||amount===undefined?"—":`UGX ${Number(amount).toLocaleString("en-GB")}`;
export const day=(iso:string|null)=>iso?new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";
export const when=(iso:string|null)=>iso?new Date(iso).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
export const todayIso=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
