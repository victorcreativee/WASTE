// Shared types and labels for disposal verification (Module 8): the company's disposal records and KCCA's oversight.

export type DisposalState="verified"|"weighing"|"explained"|"explanation_review"|"pending"|"declared"|"unverified";
export type Standing="good"|"watch"|"action"|"no_trips";
export type Summary={states:Record<DisposalState,number>;completed_trips:number;due_trips:number;exceptions:number;verified_kg:number;verification_rate:number|null;standing:Standing;unlinked_tickets:number;unlinked_kg:number};
export type FacilityTotal={code:string;name:string;tickets:number;net_kg:number};
export type Rules={graceHours:number;unlinkedTicketHours:number;goodRate:number;actionRate:number;firstDate:string};
export type Period={from:string;to:string;label:string};
export type Trip={trip_id:string;organization_id:string;organization_name:string;trip_number:string|null;route_name:string;route_date:string;completed_at:string;plate_number:string|null;state:DisposalState;ticket_id:string|null;ticket_number:string|null;net_kg:string|null;facility:string|null;declared_ticket:string|null;declared_kg:string|null;explanation_id:string|null;explanation_status:string|null;explanation_reason:string|null;explanation_details:string|null;explanation_review_note:string|null};
export type Ticket={id:string;organization_id:string;organization_name:string;ticket_number:string;facility:string;facility_code:string;registration:string;driver_name:string;operation_date:string;arrival_at:string;departure_at:string|null;net_kg:string|null;status:string;trip_id:string|null;trip_number:string|null;no_trip_reason:string|null;no_trip_accepted_at:string|null;unlinked:boolean;past_window:boolean};

export const STATE:Record<DisposalState,{label:string;className:string}>={
  verified:{label:"Verified",className:"status status-active normal-case"},
  weighing:{label:"On the weighbridge",className:"status status-pending normal-case"},
  explained:{label:"Explained",className:"status status-active normal-case"},
  explanation_review:{label:"Explanation with KCCA",className:"status status-pending normal-case"},
  pending:{label:"Within 48 hours",className:"status normal-case"},
  declared:{label:"Self-declared only",className:"status status-failed normal-case"},
  unverified:{label:"No disposal record",className:"status status-failed normal-case"},
};
export const STANDING:Record<Standing,{label:string;className:string}>={
  good:{label:"Good",className:"status status-active normal-case"},
  watch:{label:"Watch",className:"status status-pending normal-case"},
  action:{label:"Action required",className:"status status-failed normal-case"},
  no_trips:{label:"No trips due",className:"status normal-case"},
};
export const REASONS:Array<[string,string]>=[
  ["no_load","The vehicle came back empty"],
  ["delivered_elsewhere","Delivered to a licensed recycler or other approved site"],
  ["vehicle_breakdown","Vehicle broke down; load transferred"],
  ["combined_load","Combined with another trip's load"],
  ["weighbridge_unavailable","Weighbridge not working"],
  ["other","Other"],
];
export const reasonLabel=(code:string|null)=>REASONS.find(([key])=>key===code)?.[1]||code||"";
export const PERIODS:Array<[string,string]>=[["30d","Last 30 days"],["90d","Last 90 days"],["year","This year"]];
export const tonnes=(kg:number|string|null|undefined)=>kg===null||kg===undefined?"—":`${(Number(kg)/1000).toLocaleString("en-GB",{maximumFractionDigits:1})} t`;
export const rate=(value:number|null)=>value===null?"—":`${value.toLocaleString("en-GB",{maximumFractionDigits:1})}%`;
export const plateKey=(plate:string|null)=>(plate||"").toUpperCase().replace(/[^A-Z0-9]/g,"");
