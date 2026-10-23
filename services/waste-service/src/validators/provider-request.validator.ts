import {z} from 'zod';
export const createProviderRequestSchema=z.object({
  organizationId:z.string().uuid(),note:z.string().trim().max(500).optional()
});
export const reviewProviderRequestSchema=z.object({
  action:z.enum(['approve','reject']),note:z.string().trim().max(500).optional(),zoneId:z.string().uuid().optional()
});
