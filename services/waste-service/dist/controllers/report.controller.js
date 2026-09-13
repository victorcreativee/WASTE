"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizationReport = getOrganizationReport;
exports.getCityCollectorReport = getCityCollectorReport;
const organization_scope_1 = require("../middlewares/organization-scope");
const report_repository_1 = require("../repositories/report.repository");
const scope = organization_scope_1.requireOrganizationScope;
function range(q) { const now = new Date(), to = typeof q.query.to === 'string' ? q.query.to : now.toISOString().slice(0, 10), from = typeof q.query.from === 'string' ? q.query.from : new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    throw Object.assign(new Error('Choose a valid report date range'), { statusCode: 400 }); return { from, to }; }
async function getOrganizationReport(q, s) { const { from, to } = range(q); return s.json({ success: true, message: 'Organization report fetched', data: await (0, report_repository_1.organizationReport)(scope(q), from, to) }); }
async function getCityCollectorReport(q, s) { const { from, to } = range(q); return s.json({ success: true, message: 'City collector report fetched', data: await (0, report_repository_1.cityCollectorReport)(from, to) }); }
