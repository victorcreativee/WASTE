import {z} from 'zod';
const password=z.string().min(12).max(72).refine(value=>Buffer.byteLength(value,'utf8')<=72&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&/[^A-Za-z0-9]/.test(value),'Use 12–72 characters with uppercase, lowercase, number and symbol');
const ugandaPhone=z.string().trim().regex(/^\+256\d{9}$/,'Use a Ugandan number in the format +256782390653');
export const createPlatformUserSchema=z.object({fullName:z.string().trim().min(2).max(150),email:z.string().trim().email().max(254),phone:ugandaPhone.optional(),password,role:z.enum(['system_admin','kcca_admin','weighbridge_operator'])}).strict();
export const platformUserStatusSchema=z.object({status:z.enum(['active','suspended'])}).strict();
