// Shared types and labels for GPS track checks (Module 11).

export type TrackState="consistent"|"no_gps"|"no_facility_visit"|"ticket_mismatch";
export type TrackStop={lat:number;lng:number;from:string;to:string;minutes:number;offRoute:boolean|null};
export type TrackCheck={trip_id:string;organization_id:string;organization_name:string;trip_number:string|null;route_name:string;route_date:string;plate_number:string|null;state:TrackState;gps_points:number;first_point_at:string|null;last_point_at:string|null;facility_code:string|null;facility_name:string|null;facility_visit_at:string|null;ticket_id:string|null;ticket_number:string|null;ticket_facility:string|null;ticket_facility_code:string|null;ticket_arrival_at:string|null;ticket_gps_distance_m:number|null;stops:TrackStop[];off_route_stops:number;longest_stop_minutes:number;checked_at:string};
export type TrackDetail=TrackCheck&{points:Array<{lat:number;lng:number;recorded_at:string}>;facilities:Array<{code:string;name:string;radius_m:number;latitude:number;longitude:number}>;route_line:{type:"LineString";coordinates:[number,number][]}|null;rules:{disposalLegHours:number;ticketToleranceMinutes:number;mismatchMinM:number;stopMinutes:number}};

export const STATE:Record<TrackState,{label:string;className:string;help:string}>={
  consistent:{label:"Reached a facility",className:"status status-active normal-case",help:"The truck's GPS entered a disposal facility's area, and agrees with the ticket if there is one."},
  no_gps:{label:"No GPS track",className:"status normal-case",help:"Too few GPS points to judge: location sharing was off or the phone was offline."},
  no_facility_visit:{label:"Never reached a facility",className:"status status-failed normal-case",help:"The GPS track never entered a disposal facility's area during the trip or the disposal leg."},
  ticket_mismatch:{label:"GPS contradicts ticket",className:"status status-failed normal-case",help:"When the weighbridge ticket was recorded, the truck's GPS put it far from that facility."},
};
export const time=(iso:string|null)=>iso?new Date(iso).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"}):"—";
export const km=(m:number|null)=>m===null?"—":m>=1000?`${(m/1000).toFixed(1)} km`:`${m} m`;
