import {z} from 'zod';
export const attendanceDateSchema=z.string().date();
const time=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Use a valid 24-hour time');
export const attendanceSchema=z.object({userId:z.string().uuid(),workDate:attendanceDateSchema,shiftName:z.string().trim().min(2).max(80).default('Day shift'),shiftStart:time.optional(),shiftEnd:time.optional(),status:z.enum(['scheduled','present','late','absent','leave']),notes:z.string().trim().max(500).optional()});
