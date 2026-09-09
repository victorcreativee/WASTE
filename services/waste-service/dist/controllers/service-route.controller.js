"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthorizedDivisions = getAuthorizedDivisions;
exports.getDivisionAreaCatalog = getDivisionAreaCatalog;
exports.getServiceRoutes = getServiceRoutes;
exports.postServiceRoute = postServiceRoute;
exports.patchServiceRoute = patchServiceRoute;
exports.getServiceRouteCustomers = getServiceRouteCustomers;
exports.putServiceRouteCustomers = putServiceRouteCustomers;
const service_route_validator_1 = require("../validators/service-route.validator");
const service_route_repository_1 = require("../repositories/service-route.repository");
function identity(req) {
    const auth = req.auth;
    if (!auth?.organizationId)
        throw Object.assign(new Error("Your account must belong to an organization"), { statusCode: 403 });
    return { organizationId: auth.organizationId, userId: auth.userId };
}
async function getAuthorizedDivisions(req, res) { const { organizationId } = identity(req); return res.json({ success: true, message: "Authorized divisions fetched", data: await (0, service_route_repository_1.findAuthorizedDivisions)(organizationId) }); }
async function getDivisionAreaCatalog(req, res) { const { organizationId } = identity(req); return res.json({ success: true, message: "Division areas fetched", data: await (0, service_route_repository_1.findDivisionAreaCatalog)(organizationId) }); }
async function getServiceRoutes(req, res) { const { organizationId } = identity(req); return res.json({ success: true, message: "Service routes fetched", data: await (0, service_route_repository_1.findServiceRoutes)(organizationId) }); }
async function postServiceRoute(req, res) { const id = identity(req), input = service_route_validator_1.createServiceRouteSchema.parse(req.body); const data = await (0, service_route_repository_1.insertServiceRoute)(id.organizationId, id.userId, input); return res.status(201).json({ success: true, message: "Route created. Assign customers to make it ready for trips.", data }); }
async function patchServiceRoute(req, res) { const { organizationId } = identity(req), input = service_route_validator_1.updateServiceRouteSchema.parse(req.body), data = await (0, service_route_repository_1.updateServiceRoute)(organizationId, req.params.id, input); if (!data)
    return res.status(404).json({ success: false, message: "Service route not found" }); return res.json({ success: true, message: "Route updated", data }); }
async function getServiceRouteCustomers(req, res) { const { organizationId } = identity(req), data = await (0, service_route_repository_1.findServiceRouteCustomers)(organizationId, req.params.id); if (!data)
    return res.status(404).json({ success: false, message: "Service route not found" }); return res.json({ success: true, message: "Route customers fetched", data }); }
async function putServiceRouteCustomers(req, res) { const id = identity(req), input = service_route_validator_1.assignServiceRouteCustomersSchema.parse(req.body), data = await (0, service_route_repository_1.replaceServiceRouteCustomers)(id.organizationId, id.userId, req.params.id, input.serviceLocationIds); if (!data)
    return res.status(404).json({ success: false, message: "Active service route not found" }); return res.json({ success: true, message: `Route updated with ${data.customerCount} customers`, data }); }
