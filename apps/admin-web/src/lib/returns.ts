// Labels shared by the company returns page and the KCCA returns register. Keep in step with
// services/waste-service/src/services/regulatory-returns.rules.ts.

export const COLLECTOR_FIELDS:Array<[string,string,string]>=[
  ["customers_served","Customers served","Households and businesses with an active service agreement during the month"],
  ["trips_completed","Collection trips completed","Trips that reached completion"],
  ["collections_completed","Scheduled collections completed",""],
  ["collections_missed","Scheduled collections missed",""],
  ["waste_disposed_kg","Waste delivered for disposal (kg)","Net weight on weighbridge tickets or disposal receipts"],
  ["vehicles_operated","Vehicles operated","Vehicles used for collection during the month"],
  ["staff_employed","Staff employed","At the end of the month"],
  ["complaints_received","Resident complaints received",""],
  ["complaints_resolved","Resident complaints resolved",""],
];

export const FACTORY_FIELDS:Array<[string,string,string]>=[
  ["accepted_kg","Material accepted (kg)","Received minus what was rejected at the gate"],
  ["rejected_kg","Material rejected at the gate (kg)",""],
  ["processed_kg","Material processed (kg)","Put into processing batches"],
  ["output_kg","Product output (kg)",""],
  ["residue_kg","Processing residue (kg)","Left over and sent for disposal"],
  ["dispatched_kg","Product dispatched (kg)",""],
  ["staff_employed","Staff employed","At the end of the month"],
];

export const MATERIAL_CATEGORIES:Array<[string,string]>=[["plastic","Plastic"],["paper","Paper and cardboard"],["metal","Metal"],["glass","Glass"],["organic","Organic"],["textile","Textile"],["other","Other"]];

export const FIELD_LABEL:Record<string,string>={
  ...Object.fromEntries(COLLECTOR_FIELDS.map(([key,label])=>[key,label])),
  ...Object.fromEntries(FACTORY_FIELDS.map(([key,label])=>[key,label])),
  ...Object.fromEntries(MATERIAL_CATEGORIES.flatMap(([key,label])=>[[`${key}_collected_kg`,`${label} collected (kg)`],[`${key}_sold_kg`,`${label} sold (kg)`]])),
  residue_kg:"Residue (kg)",
};

export const RETURN_STATE:Record<string,{label:string;className:string}>={
  due:{label:"Due",className:"status status-scheduled normal-case"},
  overdue:{label:"Overdue",className:"status status-overdue normal-case"},
  submitted:{label:"Submitted",className:"status status-in-progress normal-case"},
  queried:{label:"Queried by KCCA",className:"status status-pending normal-case"},
  accepted:{label:"Accepted",className:"status status-active normal-case"},
};

export const monthName=(period:string)=>new Date(`${period}-01T00:00:00`).toLocaleDateString("en-GB",{month:"long",year:"numeric"});
export const shortDate=(iso:string|null)=>iso?new Date(`${iso.slice(0,10)}T00:00:00`).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}):"—";

export const organizationTypeLabel=(type:string)=>type==="recycling_company"?"Recycling company":type==="processing_plant"?"Recycling factory":"Waste collector";
