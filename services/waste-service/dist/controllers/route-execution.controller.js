"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDriverDashboardHandler = getDriverDashboardHandler;
exports.dispatchCollectionRouteHandler = dispatchCollectionRouteHandler;
exports.cancelCollectionRouteHandler = cancelCollectionRouteHandler;
exports.getDriverRoutesHandler = getDriverRoutesHandler;
exports.getDriverRouteDetailsHandler = getDriverRouteDetailsHandler;
exports.startDriverRouteHandler = startDriverRouteHandler;
exports.arriveAtRouteStopHandler = arriveAtRouteStopHandler;
exports.completeRouteStopHandler = completeRouteStopHandler;
const route_execution_repository_1 = require("../repositories/route-execution.repository");
const route_execution_validator_1 = require("../validators/route-execution.validator");
function identity(req) { return req.auth; }
function scope(req) {
    const auth = identity(req);
    return auth.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? auth.organizationId : null;
}
function driverUserId(req) { return identity(req).roles.includes("driver") ? identity(req).userId : null; }
async function getDriverDashboardHandler(req, res) {
    const data = await (0, route_execution_repository_1.findDriverDashboard)(identity(req).userId);
    if (!data)
        return res.status(404).json({ success: false, message: "Driver profile is not connected to this account" });
    return res.json({ success: true, message: "Driver dashboard fetched", data });
}
async function dispatchCollectionRouteHandler(req, res) {
    const organizationId = identity(req).organizationId;
    const route = await (0, route_execution_repository_1.dispatchCollectionRoute)(req.params.routeId, organizationId);
    return res.status(200).json({ success: true, message: "Route dispatched to the assigned driver", data: route });
}
async function cancelCollectionRouteHandler(req, res) {
    const auth = identity(req);
    const input = route_execution_validator_1.cancelCollectionRouteSchema.parse(req.body);
    const route = await (0, route_execution_repository_1.cancelCollectionRoute)(req.params.routeId, auth.organizationId, auth.userId, input);
    return res.status(200).json({
        success: true,
        message: `${route.returned_job_count} unfinished jobs returned to dispatch`,
        data: route,
    });
}
async function getDriverRoutesHandler(req, res) {
    const routes = await (0, route_execution_repository_1.findDriverRoutes)(req.params.driverId ?? "", scope(req), driverUserId(req));
    return res.status(200).json({ success: true, message: "Driver routes fetched", data: routes });
}
async function getDriverRouteDetailsHandler(req, res) {
    const route = await (0, route_execution_repository_1.findDriverRouteDetails)(req.params.routeId, scope(req), driverUserId(req));
    if (!route)
        return res.status(404).json({ success: false, message: "Route not found in your scope" });
    return res.status(200).json({ success: true, message: "Driver route fetched", data: route });
}
async function startDriverRouteHandler(req, res) {
    const route = await (0, route_execution_repository_1.startDriverRoute)(req.params.routeId, identity(req).userId);
    if (!route)
        return res.status(400).json({ success: false, message: "This assigned route cannot be started" });
    return res.status(200).json({ success: true, message: "Route started", data: route });
}
async function arriveAtRouteStopHandler(req, res) {
    const stop = await (0, route_execution_repository_1.arriveAtRouteStop)(req.params.stopId, identity(req).userId);
    if (!stop)
        return res.status(400).json({ success: false, message: "Complete the previous stop before arriving here" });
    return res.status(200).json({ success: true, message: "Arrival recorded", data: stop });
}
async function completeRouteStopHandler(req, res) {
    const input = route_execution_validator_1.completeRouteStopSchema.parse(req.body);
    const stop = await (0, route_execution_repository_1.completeRouteStop)(req.params.stopId, identity(req).userId, input);
    if (!stop)
        return res.status(400).json({ success: false, message: "Record arrival before completing this stop" });
    return res.status(200).json({ success: true, message: stop.route_completed ? "Stop and route completed" : "Stop completed", data: stop });
}
