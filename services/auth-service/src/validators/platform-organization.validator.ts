import { z } from "zod";

const password = z.string().min(12).max(128)
  .regex(/[a-z]/, "Temporary password needs a lowercase letter")
  .regex(/[A-Z]/, "Temporary password needs an uppercase letter")
  .regex(/[0-9]/, "Temporary password needs a number")
  .regex(/[^A-Za-z0-9]/, "Temporary password needs a symbol");

export const resetOrganizationSchema = z.object({
  mode: z.enum(["data_only", "data_and_credentials"]),
  confirmationName: z.string().trim().min(2).max(150),
  reason: z.string().trim().min(10).max(500),
  administratorUserId: z.string().uuid().optional(),
  temporaryPassword: password.optional(),
}).strict().superRefine((value, context) => {
  if (value.mode !== "data_and_credentials") return;
  if (!value.administratorUserId) context.addIssue({ code: "custom", path: ["administratorUserId"], message: "Choose the administrator who will retain access" });
  if (!value.temporaryPassword) context.addIssue({ code: "custom", path: ["temporaryPassword"], message: "Create a temporary administrator password" });
});

export type ResetOrganizationInput = z.infer<typeof resetOrganizationSchema>;
