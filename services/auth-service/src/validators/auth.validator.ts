import { normalizeUgandanPhone } from "../utils/sms";
import { z } from "zod";

export const registerSchema = z.object({
  organizationId: z.string().uuid().optional(),
  fullName: z.string().min(2, "Full name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().optional(),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Valid email is required"),
  password: z.string().min(1, "Password is required"),
});
export const changePasswordSchema=z.object({currentPassword:z.string().min(1),newPassword:z.string().min(12).max(72).refine(value=>/[A-Z]/.test(value)&&/[a-z]/.test(value)&&/\d/.test(value),"Use uppercase, lowercase and a number")}).strict();

export const organizationApplicantRegisterSchema = z.object({
  companyType: z.enum(["waste_collection_company", "recycling_company"]),
  companyName: z.string().trim().min(2).max(150),
  registrationNumber: z.string().trim().toUpperCase().min(3).max(50).regex(/^[A-Z0-9][A-Z0-9 .\/-]*$/, "Use a valid company registration number"),
  fullName: z.string().trim().min(2).max(150).regex(/^[\p{L}][\p{L} .'-]*$/u, "Enter a valid contact name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email such as name@mailcompany.com").max(254),
  phone: z.string().trim().regex(/^\+256\d{9}$/, "Use 12 characters in Uganda format, for example +256782390653"),
  password: z.string().min(12).max(72).refine(value => /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value), "Use uppercase, lowercase and a number"),
}).strict();
export type OrganizationApplicantRegisterInput = z.infer<typeof organizationApplicantRegisterSchema>;

export const createOrganizationUserSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.string().email(),
  phone: z.string().trim().max(50).optional(),
  password: z.string().min(8).max(128),
  role: z.enum(["supervisor", "driver", "recycling_collector", "recycling_sales", "recycling_field_manager"]),
  licenseNumber: z.string().trim().max(100).optional(),
});

// Households often have no email address: a phone number is enough, and they sign in with a private link or SMS code.
export const createOrganizationCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(150),
  email: z.union([z.string().trim().email(), z.literal("")]).optional().transform((value) => value || undefined),
  phone: z.string().trim().max(50).optional(),
  password: z.union([z.string().min(8).max(128), z.literal("")]).optional().transform((value) => value || undefined),
  customerType: z.enum(["residential", "commercial", "office_business", "industrial"]),
  zoneId: z.string().uuid("Choose a valid service zone"),
  locationLabel: z.string().trim().min(2).max(100).default("Primary location"),
  address: z.string().trim().min(5).max(500),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
}).refine(value=>(value.latitude===undefined)===(value.longitude===undefined),{message:"Provide both latitude and longitude, or leave both empty",path:["latitude"]})
  .refine(value=>Boolean(value.email)||Boolean(value.phone&&normalizeUgandanPhone(value.phone)),{message:"Enter the household's mobile number (or an email address)",path:["phone"]})
  .refine(value=>!value.password||Boolean(value.email),{message:"A password is only used with an email address",path:["password"]});

export const updateOrganizationUserStatusSchema = z.object({
  status: z.enum(["active", "inactive", "suspended"]),
});

export const assignSupervisorDriversSchema = z.object({
  driverIds: z.array(z.string().uuid()).max(100),
});

export type CreateOrganizationUserInput = z.infer<typeof createOrganizationUserSchema>;
export type CreateOrganizationCustomerInput = z.infer<typeof createOrganizationCustomerSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
