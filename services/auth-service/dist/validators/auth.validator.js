"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assignSupervisorDriversSchema = exports.updateOrganizationUserStatusSchema = exports.createOrganizationCustomerSchema = exports.createOrganizationUserSchema = exports.organizationApplicantRegisterSchema = exports.loginSchema = exports.registerSchema = void 0;
const zod_1 = require("zod");
exports.registerSchema = zod_1.z.object({
    organizationId: zod_1.z.string().uuid().optional(),
    fullName: zod_1.z.string().min(2, "Full name is required"),
    email: zod_1.z.string().email("Valid email is required"),
    phone: zod_1.z.string().optional(),
    password: zod_1.z.string().min(8, "Password must be at least 8 characters"),
});
exports.loginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Valid email is required"),
    password: zod_1.z.string().min(1, "Password is required"),
});
exports.organizationApplicantRegisterSchema = zod_1.z.object({
    companyType: zod_1.z.enum(["waste_collection_company", "recycling_company"]),
    companyName: zod_1.z.string().trim().min(2).max(150),
    registrationNumber: zod_1.z.string().trim().toUpperCase().min(3).max(50).regex(/^[A-Z0-9][A-Z0-9 .\/-]*$/, "Use a valid company registration number"),
    fullName: zod_1.z.string().trim().min(2).max(150).regex(/^[\p{L}][\p{L} .'-]*$/u, "Enter a valid contact name"),
    email: zod_1.z.string().trim().toLowerCase().email("Enter a valid email such as name@mailcompany.com").max(254),
    phone: zod_1.z.string().trim().regex(/^\+256\d{9}$/, "Use 12 characters in Uganda format, for example +256782390653"),
    password: zod_1.z.string().min(12).max(72).refine(value => /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value), "Use uppercase, lowercase and a number"),
}).strict();
exports.createOrganizationUserSchema = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: zod_1.z.string().trim().max(50).optional(),
    password: zod_1.z.string().min(8).max(128),
    role: zod_1.z.enum(["supervisor", "driver", "recycling_collector", "recycling_sales"]),
    licenseNumber: zod_1.z.string().trim().max(100).optional(),
});
exports.createOrganizationCustomerSchema = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(150),
    email: zod_1.z.string().email(),
    phone: zod_1.z.string().trim().max(50).optional(),
    password: zod_1.z.string().min(8).max(128),
    customerType: zod_1.z.enum(["residential", "commercial", "office_business", "industrial"]),
    zoneId: zod_1.z.string().uuid("Choose a valid service zone"),
    locationLabel: zod_1.z.string().trim().min(2).max(100).default("Primary location"),
    address: zod_1.z.string().trim().min(5).max(500),
    latitude: zod_1.z.number().min(-90).max(90).optional(),
    longitude: zod_1.z.number().min(-180).max(180).optional(),
}).refine(value => (value.latitude === undefined) === (value.longitude === undefined), { message: "Provide both latitude and longitude, or leave both empty", path: ["latitude"] });
exports.updateOrganizationUserStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(["active", "inactive", "suspended"]),
});
exports.assignSupervisorDriversSchema = zod_1.z.object({
    driverIds: zod_1.z.array(zod_1.z.string().uuid()).max(100),
});
