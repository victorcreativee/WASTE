"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJobProblemHandler = createJobProblemHandler;
exports.getJobProblemsHandler = getJobProblemsHandler;
exports.updateJobProblemHandler = updateJobProblemHandler;
const job_problem_repository_1 = require("../repositories/job-problem.repository");
const job_problem_validator_1 = require("../validators/job-problem.validator");
function auth(req) {
    return req.auth;
}
async function createJobProblemHandler(req, res) {
    const input = job_problem_validator_1.createJobProblemSchema.parse(req.body);
    const problem = await (0, job_problem_repository_1.createDriverJobProblem)(req.params.jobId, auth(req).userId, input.category, input.description);
    if (!problem)
        return res.status(404).json({ success: false, message: "Active assigned job not found" });
    return res.status(201).json({ success: true, message: "Problem reported", data: problem });
}
async function getJobProblemsHandler(req, res) {
    const identity = auth(req);
    const isDriver = identity.roles.includes("driver");
    const organizationId = identity.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? identity.organizationId : null;
    const problems = await (0, job_problem_repository_1.findDriverJobProblems)(organizationId, isDriver ? identity.userId : null);
    return res.status(200).json({ success: true, message: "Job problems fetched", data: problems });
}
async function updateJobProblemHandler(req, res) {
    const input = job_problem_validator_1.updateJobProblemSchema.parse(req.body);
    const identity = auth(req);
    const organizationId = identity.roles.some((role) => ["company_admin", "supervisor"].includes(role)) ? identity.organizationId : null;
    const problem = await (0, job_problem_repository_1.updateDriverJobProblem)(req.params.problemId, organizationId, input.status, input.resolutionNotes);
    if (!problem)
        return res.status(404).json({ success: false, message: "Problem not found in your scope" });
    return res.status(200).json({ success: true, message: "Problem updated", data: problem });
}
