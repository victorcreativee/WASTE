import {z} from 'zod';
const password=z.string().min(12).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&/[^A-Za-z0-9]/.test(value),'Use 12–72 characters with uppercase, lowercase, number and symbol');
export const createPlatformUserSchema=z.object({fullName:z.string().trim().min(2).max(150),email:z.string().trim().email().max(254),phone:z.string().trim().max(50).optional(),password,role:z.enum(['system_admin','kcca_admin'])}).strict();
export const platformUserStatusSchema=z.object({status:z.enum(['active','suspended'])}).strict();
