import { z } from "zod";

export const truckStatusSchema = z.object({ status: z.enum(["available", "assigned", "maintenance", "inactive"]) });
export const maintenanceSchema = z.object({
  category: z.enum(["preventive_service","inspection","repair","tyres","engine","electrical","other"]),
  title: z.string().trim().min(2).max(160), description: z.string().trim().max(2000).optional(),
  status: z.enum(["scheduled","in_progress","completed","cancelled"]).default("scheduled"),
  scheduledDate: z.string().date(), odometerKm: z.number().int().nonnegative().optional(),
  costUgx: z.number().int().nonnegative().default(0), serviceProvider: z.string().trim().max(160).optional(),
});
export const maintenanceStatusSchema = z.object({ status: z.enum(["scheduled","in_progress","completed","cancelled"]) });
export const truckDocumentSchema = z.object({
  documentType: z.enum(["registration","insurance","inspection","operating_license","other"]),
  documentNumber: z.string().trim().min(2).max(120), issuedOn: z.string().date().optional(),
  expiresOn: z.string().date(), fileUrl: z.string().url().optional().or(z.literal("")),
});
export const fuelRecordSchema = z.object({
  litres: z.number().positive(), costUgx: z.number().int().nonnegative(), odometerKm: z.number().int().nonnegative().optional(),
  fuelDate: z.string().date(), station: z.string().trim().max(160).optional(),
});
export const vehicleLocationSchema = z.object({
  routeId: z.string().uuid(), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(10000).optional(), speedKph: z.number().nonnegative().max(250).optional(),
  headingDegrees: z.number().min(0).max(360).optional(), recordedAt: z.string().datetime().optional(),
});
export const vehicleHistoryQuerySchema = z.object({
  minutes: z.coerce.number().int().min(15).max(1440).default(120),
});
export const fleetAlertReviewSchema = z.object({
  alertCode: z.enum(["signal_missing","off_route","stopped_too_long"]),
  action: z.enum(["acknowledged","resolved","escalated"]),
  outcome: z.enum(["driver_contacted","vehicle_redirected","assistance_dispatched","false_alarm","work_resumed","other"]).optional(),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value,ctx)=>{if(value.action!=="acknowledged"&&!value.outcome)ctx.addIssue({code:"custom",path:["outcome"],message:"Choose an operational outcome"});if(value.action!=="acknowledged"&&(!value.notes||value.notes.length<3))ctx.addIssue({code:"custom",path:["notes"],message:"Add a short resolution note"});});
