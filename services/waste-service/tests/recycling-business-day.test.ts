import assert from 'node:assert/strict';
import test from 'node:test';
import {assertRecyclingBusinessDayOpen,assertRecyclingBusinessDaysOpen} from '../src/services/recycling-business-day';

const org='aaaaaaaa-0000-4000-8000-000000000001';

test('an open business day is locked before its closure state is checked',async()=>{
 const calls:{sql:string;params?:unknown[]}[]=[];
 const queryable={query:async(sql:string,params?:unknown[])=>{calls.push({sql,params});return{rows:[]}}};
 await assertRecyclingBusinessDayOpen(queryable,org,'2026-11-03','recording this purchase');
 assert.match(calls[0].sql,/pg_advisory_xact_lock/);
 assert.deepEqual(calls[0].params,[`recycling-close:${org}:2026-11-03`]);
 assert.match(calls[1].sql,/recycling_daily_closures/);
});

test('a closed business day returns a conflict with clear recovery guidance',async()=>{
 const queryable={query:async(sql:string)=>({rows:sql.includes('recycling_daily_closures')?[{closed:true}]:[]})};
 await assert.rejects(
  assertRecyclingBusinessDayOpen(queryable,org,'2026-11-02','recording this sale'),
  (error:any)=>error.statusCode===409&&/must reopen it before recording this sale/.test(error.message),
 );
});

test('moving a record locks unique business days in stable order',async()=>{
 const locks:string[]=[];
 const queryable={query:async(sql:string,params?:unknown[])=>{if(sql.includes('pg_advisory'))locks.push(String(params?.[0]));return{rows:[]}}};
 await assertRecyclingBusinessDaysOpen(queryable,org,['2026-11-03','2026-11-01','2026-11-03'],'correcting this purchase');
 assert.deepEqual(locks,[`recycling-close:${org}:2026-11-01`,`recycling-close:${org}:2026-11-03`]);
});
