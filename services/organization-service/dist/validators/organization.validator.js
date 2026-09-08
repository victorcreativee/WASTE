"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOrganizationSchema = void 0;
const zod_1 = require("zod");
exports.createOrganizationSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, "Organization name is required"),
    type: zod_1.z.enum([
        "kcca",
        "waste_collection_company",
        "recycling_company",
        "processing_plant",
        "environment_agency",
        "business",
        "citizen_group",
        "system",
    ]),
    email: zod_1.z.string().email().optional(),
    phone: zod_1.z.string().optional(),
    address: zod_1.z.string().optional(),
});
