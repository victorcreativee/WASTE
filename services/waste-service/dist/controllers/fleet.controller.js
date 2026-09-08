"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFleetOverview = getFleetOverview;
exports.getFleetTruck = getFleetTruck;
exports.createMaintenance = createMaintenance;
exports.patchMaintenance = patchMaintenance;
exports.createDocument = createDocument;
exports.createFuel = createFuel;
exports.patchTruck = patchTruck;
const repo = __importStar(require("../repositories/fleet.repository"));
const fleet_validator_1 = require("../validators/fleet.validator");
const auth = (r) => r.auth;
const scope = (r) => auth(r).roles.some(x => ['company_admin', 'supervisor'].includes(x)) ? auth(r).organizationId : null;
const org = (r) => { const id = auth(r).organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; };
async function getFleetOverview(req, res) { return res.json({ success: true, message: 'Fleet overview fetched', data: await repo.fleetOverview(scope(req)) }); }
async function getFleetTruck(req, res) { const data = await repo.fleetTruckDetail(req.params.truckId, scope(req)); return data ? res.json({ success: true, message: 'Truck details fetched', data }) : res.status(404).json({ success: false, message: 'Truck not found' }); }
async function createMaintenance(req, res) { const data = await repo.addMaintenance(req.params.truckId, org(req), auth(req).userId, fleet_validator_1.maintenanceSchema.parse(req.body)); return data ? res.status(201).json({ success: true, message: 'Maintenance record added', data }) : res.status(404).json({ success: false, message: 'Truck not found in your organization' }); }
async function patchMaintenance(req, res) { const data = await repo.updateMaintenanceStatus(req.params.id, org(req), fleet_validator_1.maintenanceStatusSchema.parse(req.body).status); return data ? res.json({ success: true, message: 'Maintenance status updated', data }) : res.status(404).json({ success: false, message: 'Maintenance record not found' }); }
async function createDocument(req, res) { const data = await repo.addTruckDocument(req.params.truckId, org(req), auth(req).userId, fleet_validator_1.truckDocumentSchema.parse(req.body)); return data ? res.status(201).json({ success: true, message: 'Compliance document added', data }) : res.status(404).json({ success: false, message: 'Truck not found in your organization' }); }
async function createFuel(req, res) { const data = await repo.addFuelRecord(req.params.truckId, org(req), auth(req).userId, fleet_validator_1.fuelRecordSchema.parse(req.body)); return data ? res.status(201).json({ success: true, message: 'Fuel expense recorded', data }) : res.status(404).json({ success: false, message: 'Truck not found in your organization' }); }
async function patchTruck(req, res) { const data = await repo.updateTruckStatus(req.params.truckId, org(req), fleet_validator_1.truckStatusSchema.parse(req.body).status); return data ? res.json({ success: true, message: 'Truck availability updated', data }) : res.status(404).json({ success: false, message: 'Truck not found in your organization' }); }
