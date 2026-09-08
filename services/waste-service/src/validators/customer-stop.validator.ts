import{z}from'zod';
export const customerStopActionSchema=z.object({
 action:z.enum(['arrive','complete','skip']),
 collectedWeightKg:z.number().min(0).optional(),
 notes:z.string().trim().max(1000).optional(),
 evidenceUrl:z.string().url().max(1000).optional(),
 exceptionReason:z.enum(['blocked_access','customer_unavailable','waste_not_ready','unsafe_conditions','vehicle_access','other']).optional(),
 exceptionNotes:z.string().trim().min(3).max(1000).optional()
}).superRefine((value,ctx)=>{
 if(value.action==='skip'&&!value.exceptionReason)ctx.addIssue({code:'custom',path:['exceptionReason'],message:'Choose why the pickup could not be completed'});
 if(value.action==='skip'&&value.exceptionReason==='other'&&!value.exceptionNotes)ctx.addIssue({code:'custom',path:['exceptionNotes'],message:'Explain the pickup issue'});
});
export const customerStopExceptionReviewSchema=z.object({
 action:z.enum(['resolve','reschedule']),
 targetJobId:z.string().uuid().optional(),
 reviewNotes:z.string().trim().min(3).max(1000)
}).superRefine((value,ctx)=>{if(value.action==='reschedule'&&!value.targetJobId)ctx.addIssue({code:'custom',path:['targetJobId'],message:'Choose a future collection job'});});
