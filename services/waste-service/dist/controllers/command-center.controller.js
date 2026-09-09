"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCommandCenterSummaryHandler = getCommandCenterSummaryHandler;
const organization_scope_1 = require("../middlewares/organization-scope");
const command_center_repository_1 = require("../repositories/command-center.repository");
async function getCommandCenterSummaryHandler(req, res) {
    const organizationId = (0, organization_scope_1.operationalOrganizationScope)(req);
    const summary = await (0, command_center_repository_1.getCommandCenterSummary)(organizationId ?? null);
    return res.status(200).json({
        success: true,
        message: "Command center summary fetched successfully",
        data: summary,
    });
}
