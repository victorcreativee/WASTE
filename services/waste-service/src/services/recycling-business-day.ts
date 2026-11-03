type Queryable={query:(sql:string,params?:unknown[])=>Promise<{rows:any[]}>};

const closedDayError=(day:string,operation:string)=>Object.assign(
 new Error(`Business day ${day} is closed. A company administrator must reopen it before ${operation}.`),
 {statusCode:409},
);

/**
 * Serializes operational writes with day closing and refuses changes to a closed day.
 * Every supported client (web, desktop, mobile and offline sync) reaches this server guard.
 */
export async function assertRecyclingBusinessDayOpen(q:Queryable,organizationId:string,day:string,operation:string){
 await q.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`recycling-close:${organizationId}:${day}`]);
 const closed=(await q.query(`SELECT 1 FROM recycling_daily_closures WHERE organization_id=$1::uuid AND operating_date=$2::date AND status='closed'`,[organizationId,day])).rows.length>0;
 if(closed)throw closedDayError(day,operation);
}

/** Locks dates in a stable order so moving a transaction between days cannot deadlock. */
export async function assertRecyclingBusinessDaysOpen(q:Queryable,organizationId:string,days:string[],operation:string){
 for(const day of [...new Set(days)].sort())await assertRecyclingBusinessDayOpen(q,organizationId,day,operation);
}
