"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommandCenterSummaryHandler = getCommandCenterSummaryHandler;
const command_center_repository_1 = require("../repositories/command-center.repository");
async function getCommandCenterSummaryHandler(req, res) {
    const auth = req.auth;
    const organizationId = auth?.roles.some((role) => ["company_admin", "supervisor"].includes(role))
        ? auth.organizationId
        : null;
    const summary = await (0, command_center_repository_1.getCommandCenterSummary)(organizationId ?? null);
    return res.status(200).json({
        success: true,
        message: "Command center summary fetched successfully",
        data: summary,
    });
}
