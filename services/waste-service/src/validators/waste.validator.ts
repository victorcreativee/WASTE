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
export const createPickupScheduleSchema = z.object({
  organizationId: z.string().uuid().optional(),
  zoneId: z.string().uuid("Valid zone ID is required"),
  name: z.string().min(2, "Schedule name is required"),
  frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "on_demand"]),
  preferredTime: z.string().optional(),
});

export const createCollectionJobSchema = z.object({
  organizationId: z.string().uuid().optional(),
  zoneId: z.string().uuid("Valid zone ID is required"),
  truckId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  scheduleId: z.string().uuid().optional(),
  jobDate: z.string().min(1, "Job date is required"),
  wasteType: z
    .enum([
      "mixed",
      "organic",
      "plastic",
      "metal",
      "paper",
      "glass",
      "hazardous",
      "medical",
      "construction",
    ])
    .optional(),
  estimatedWeightKg: z.number().optional(),
  notes: z.string().optional(),
});

export const updateCollectionJobStatusSchema = z.object({
  status: z.enum([
    "pending",
    "assigned",
    "in_progress",
    "completed",
    "missed",
    "cancelled",
  ]),
  collectedWeightKg: z.number().optional(),
  notes: z.string().optional(),
});
export const assignCollectionJobSchema = z.object({
  truckId: z.string().uuid("Valid truck ID is required"),
  driverId: z.string().uuid("Valid driver ID is required"),
});
export const generateCollectionJobsSchema = z.object({
  startDate: z.string().min(1, "Start date is required"),
  daysAhead: z.number().int().min(1).max(90).default(30),
  truckId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  wasteType: z
    .enum([
      "mixed",
      "organic",
      "plastic",
      "metal",
      "paper",
      "glass",
      "hazardous",
      "medical",
      "construction",
    ])
    .optional(),
  estimatedWeightKg: z.number().optional(),
  notes: z.string().optional(),
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type CreateTruckInput = z.infer<typeof createTruckSchema>;
export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type CreatePickupScheduleInput = z.infer<
  typeof createPickupScheduleSchema
>;

export type CreateCollectionJobInput = z.infer<
  typeof createCollectionJobSchema
>;

export type UpdateCollectionJobStatusInput = z.infer<
  typeof updateCollectionJobStatusSchema
>;
export type AssignCollectionJobInput = z.infer<
  typeof assignCollectionJobSchema
>;
export type GenerateCollectionJobsInput = z.infer<
  typeof generateCollectionJobsSchema
>;
