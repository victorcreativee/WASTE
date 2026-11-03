// Shared types and labels for electronic collection receipts (migration 111): the company ledger, KCCA's audit and the
// public receipt page that receipt SMS link to.

export type Receipt={id:string;organization_id:string;serial_number:string;chain_position:string;collected_at:string;issued_at:string;collected_weight_kg:string|null;
  company_name:string;customer_name:string;customer_phone:string|null;location_label:string;address:string;zone_name:string|null;truck_plate:string|null;driver_name:string|null;
  record_hash:string;void_reason:string|null;voided_at:string|null;voided_by_name:string|null;sms_status:string|null;sms_sent_at:string|null;sms_error:string|null};
export type ReceiptExport={id:string;organization_id:string;organization_name:string;export_date:string;receipt_count:number;void_count:number;first_serial:string|null;last_serial:string|null;content_sha256:string;signing_key_id:string;generated_at:string};
export type ChainCheck={checked:number;intact:boolean;first_broken_serial:string|null;checked_at:string};
export type ReceiptSummary={today:number;this_month:number;voided_this_month:number;without_phone_30d:number;sms_failed_30d:number;series:{code:string;last_position:string;first_issued_on:string}|null;last_export:{export_date:string;generated_at:string}|null};
export type ReceiptOperator={organization_id:string;organization_name:string;code:string;first_issued_on:string|null;total_receipts:string;receipts_7d:number;voids_30d:number;last_export_date:string|null;missing_exports:number};
export type ReceiptSettings={serial_format:string;updated_at:string;updated_by_name:string|null;signing_key_id:string;signing_public_key:string;development_key:boolean};
export type PublicReceipt={serial_number:string;company_name:string;customer_name:string;location_label:string;zone_name:string|null;collected_at:string;issued_at:string;collected_weight_kg:string|null;truck_plate:string|null;voided_at:string|null;void_reason:string|null;intact:boolean;status:"valid"|"voided"};

export const dateTime=(iso:string|null)=>iso?new Date(iso).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Africa/Kampala"}):"—";
export const kg=(value:string|number|null)=>value===null||value===undefined?"—":`${Number(value).toLocaleString("en-GB",{maximumFractionDigits:2})} kg`;

export function smsState(r:Pick<Receipt,"customer_phone"|"sms_status"|"sms_error">):{label:string;className:string}{
  if(!r.customer_phone)return{label:"No phone",className:"status normal-case"};
  switch(r.sms_status){
    case "sent":return{label:"SMS sent",className:"status status-active normal-case"};
    case "failed":return{label:"SMS failed",className:"status status-failed normal-case"};
    case "skipped":return{label:"SMS not sent",className:"status status-failed normal-case"};
    default:return{label:"SMS queued",className:"status status-pending normal-case"};
  }
}

/** The serial a format produces; mirrors format_receipt_serial() on the server, for the KCCA settings preview. */
export function previewSerial(format:string,code:string,at:Date,sequence:number){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Africa/Kampala",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(at).map(p=>[p.type,p.value]));
  return format.replaceAll("{ORG}",code).replaceAll("{YYYY}",parts.year).replaceAll("{YY}",parts.year.slice(2)).replaceAll("{MM}",parts.month).replaceAll("{DD}",parts.day)
    .replace(/\{SEQ([4-9])\}/,(_,width)=>String(sequence).padStart(Number(width),"0"));
}
