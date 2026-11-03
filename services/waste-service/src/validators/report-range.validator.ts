import { z } from 'zod';
export const reportRangeSchema=z.object({from:z.iso.date(),to:z.iso.date()}).superRefine((value,ctx)=>{
 if(value.from>value.to)ctx.addIssue({code:'custom',path:['to'],message:'The end date must be on or after the start date'});
 if(Date.parse(value.to)-Date.parse(value.from)>366*86400000)ctx.addIssue({code:'custom',path:['to'],message:'Choose a reporting period of up to one year'});
});
