"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTrips = getTrips;
exports.postTrip = postTrip;
exports.patchTripWeight = patchTripWeight;
const trip_validator_1 = require("../validators/trip.validator");
const trip_repository_1 = require("../repositories/trip.repository");
async function getTrips(req, res) { const auth = req.auth, scope = auth.roles.some(role => ["company_admin", "supervisor"].includes(role)) ? auth.organizationId : null; return res.json({ success: true, message: "Trips fetched", data: await (0, trip_repository_1.findTrips)(scope) }); }
async function postTrip(req, res) { const auth = req.auth; if (!auth.organizationId)
    return res.status(403).json({ success: false, message: "An organization account is required" }); const data = await (0, trip_repository_1.createTrip)(auth.organizationId, auth.userId, trip_validator_1.createTripSchema.parse(req.body)); return res.status(201).json({ success: true, message: `${data.trip_number} created with ${data.customer_count} customers`, data }); }
async function patchTripWeight(req, res) { const auth = req.auth; if (!auth.organizationId)
    return res.status(403).json({ success: false, message: "An organization account is required" }); const data = await (0, trip_repository_1.verifyTripWeight)(req.params.tripId, auth.organizationId, auth.userId, trip_validator_1.verifyTripWeightSchema.parse(req.body)); return res.json({ success: true, message: "Weighbridge result verified", data }); }
