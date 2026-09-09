import { z } from "zod";

export const createServiceRouteSchema=z.object({
  divisionId:z.string().uuid("Choose a valid KCCA-authorized division"),
  zoneId:z.string().uuid("Choose a valid service zone"),
  name:z.string().trim().min(2,"Route name is required").max(150),
  code:z.string().trim().min(2).max(50).optional(),
  defaultTruckId:z.string().uuid().optional(),
  defaultDriverId:z.string().uuid().optional(),
  defaultSupervisorUserId:z.string().uuid().optional(),
  estimatedDurationMinutes:z.number().int().positive().optional(),
  estimatedDistanceKm:z.number().nonnegative().optional(),
});

export const assignServiceRouteCustomersSchema=z.object({
  serviceLocationIds:z.array(z.string().uuid()).max(1000)
    .refine(ids=>new Set(ids).size===ids.length,"Select each customer only once"),
});
export const updateServiceRouteSchema=z.object({
  name:z.string().trim().min(2).max(150).optional(),code:z.string().trim().min(2).max(50).nullable().optional(),
  isActive:z.boolean().optional(),estimatedDurationMinutes:z.number().int().positive().nullable().optional(),
  estimatedDistanceKm:z.number().nonnegative().nullable().optional(),
}).refine(value=>Object.keys(value).length>0,"Add at least one change");

export type CreateServiceRouteInput=z.infer<typeof createServiceRouteSchema>;
