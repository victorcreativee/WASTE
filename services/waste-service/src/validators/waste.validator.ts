import { z } from "zod";

export const createZoneSchema = z.object({
  organizationId: z.string().uuid().optional(),
  name: z.string().min(2, "Zone name is required"),
  description: z.string().optional(),
  areaType: z.enum([
    "residential",
    "commercial",
    "industrial",
    "market",
    "school",
    "hospital",
    "informal_settlement",
    "mixed",
  ]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const createTruckSchema = z.object({
  organizationId: z.string().uuid().optional(),
  plateNumber: z.string().min(2, "Plate number is required"),
  truckName: z.string().optional(),
  capacityTons: z.number().optional(),
});

export const createDriverSchema = z.object({
  organizationId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  fullName: z.string().min(2, "Driver name is required"),
  phone: z.string().optional(),
  licenseNumber: z.string().optional(),
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type CreateTruckInput = z.infer<typeof createTruckSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
