"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCitizenIssues = listCitizenIssues;
exports.submitCitizenIssue = submitCitizenIssue;
exports.assignIssue = assignIssue;
exports.changeIssueStatus = changeIssueStatus;
const citizen_issue_repository_1 = require("../repositories/citizen-issue.repository");
function listCitizenIssues(scope) {
    return (0, citizen_issue_repository_1.findCitizenIssues)(scope);
}
function submitCitizenIssue(userId, input) {
    return (0, citizen_issue_repository_1.createCitizenIssue)(userId, input);
}
async function assignIssue(id, organizationId, scope) {
    const updated = await (0, citizen_issue_repository_1.assignCitizenIssue)(id, organizationId);
    return updated ? (0, citizen_issue_repository_1.findCitizenIssueById)(id, scope) : null;
}
async function changeIssueStatus(id, input, scope) {
    const organizationId = scope.isCompany ? scope.organizationId : null;
    const updated = await (0, citizen_issue_repository_1.updateCitizenIssueStatus)(id, input, organizationId);
    return updated ? (0, citizen_issue_repository_1.findCitizenIssueById)(id, scope) : null;
}
