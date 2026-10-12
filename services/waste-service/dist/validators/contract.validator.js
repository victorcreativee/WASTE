"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractStatusSchema = exports.contractSchema = void 0;
const zod_1 = require("zod");
exports.contractSchema = zod_1.z.object({ customerId: zod_1.z.string().uuid(), planId: zod_1.z.string().uuid(), startsOn: zod_1.z.string().date(), endsOn: zod_1.z.string().date(), notes: zod_1.z.string().trim().max(1000).optional() }).refine(value => value.endsOn >= value.startsOn, { message: 'Contract end date must be on or after its start date', path: ['endsOn'] });
exports.contractStatusSchema = zod_1.z.object({ status: zod_1.z.enum(['active', 'suspended', 'cancelled']) });
