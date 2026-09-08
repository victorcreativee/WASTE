"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCitizenIssues = getCitizenIssues;
exports.createCitizenIssueHandler = createCitizenIssueHandler;
exports.assignCitizenIssueHandler = assignCitizenIssueHandler;
exports.updateCitizenIssueStatusHandler = updateCitizenIssueStatusHandler;
const citizen_issue_service_1 = require("../services/citizen-issue.service");
const citizen_issue_validator_1 = require("../validators/citizen-issue.validator");
function getScope(req) {
    const auth = req.auth;
    if (!auth)
        throw new Error("Unauthorized");
    return {
        userId: auth.userId,
        organizationId: auth.organizationId,
        isCitizen: auth.roles.includes("citizen"),
        isCompany: auth.roles.some((role) => ["company_admin", "supervisor"].includes(role)),
    };
}
async function getCitizenIssues(req, res) {
    const issues = await (0, citizen_issue_service_1.listCitizenIssues)(getScope(req));
    return res.status(200).json({ success: true, message: "Citizen issues fetched successfully", data: issues });
}
async function createCitizenIssueHandler(req, res) {
    const scope = getScope(req);
    const input = citizen_issue_validator_1.createCitizenIssueSchema.parse(req.body);
    const issue = await (0, citizen_issue_service_1.submitCitizenIssue)(scope.userId, input);
    return res.status(201).json({ success: true, message: "Issue submitted successfully", data: issue });
}
async function assignCitizenIssueHandler(req, res) {
    const input = citizen_issue_validator_1.assignCitizenIssueSchema.parse(req.body);
    const issue = await (0, citizen_issue_service_1.assignIssue)(req.params.id, input.organizationId, getScope(req));
    if (!issue)
        return res.status(404).json({ success: false, message: "Issue or active company not found" });
    return res.status(200).json({ success: true, message: "Issue assigned successfully", data: issue });
}
async function updateCitizenIssueStatusHandler(req, res) {
    const scope = getScope(req);
    const input = citizen_issue_validator_1.updateCitizenIssueStatusSchema.parse(req.body);
    if (scope.isCompany && !["in_progress", "resolved"].includes(input.status)) {
        return res.status(403).json({ success: false, message: "Companies may only start or resolve assigned issues" });
    }
    const issue = await (0, citizen_issue_service_1.changeIssueStatus)(req.params.id, input, scope);
    if (!issue)
        return res.status(404).json({ success: false, message: "Issue not found in your scope" });
    return res.status(200).json({ success: true, message: "Issue status updated successfully", data: issue });
}
