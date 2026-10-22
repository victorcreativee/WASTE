import{z}from'zod';
export const createComplianceSchema=z.object({organizationId:z.string().uuid(),category:z.enum(['permit','service_delivery','weighbridge','customer_service','fleet_safety','recycling_operations','statutory_returns','other']),severity:z.enum(['advisory','warning','critical']),title:z.string().trim().min(4).max(180),details:z.string().trim().min(10).max(3000),requiredAction:z.string().trim().min(5).max(2000),dueDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
export const respondComplianceSchema=z.object({response:z.string().trim().min(10).max(3000)});
export const reviewComplianceSchema=z.object({action:z.enum(['close','reopen']),notes:z.string().trim().min(5).max(2000)});
