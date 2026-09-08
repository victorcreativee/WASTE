"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrganizationReport = getOrganizationReport;
const report_repository_1 = require("../repositories/report.repository");
const scope = (q) => { const a = q.auth; return a.roles.some(r => ['company_admin', 'supervisor'].includes(r)) ? a.organizationId : null; };
async function getOrganizationReport(q, s) { const now = new Date(), fallbackTo = now.toISOString().slice(0, 10), fallbackFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10), from = typeof q.query.from === 'string' ? q.query.from : fallbackFrom, to = typeof q.query.to === 'string' ? q.query.to : fallbackTo; if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to)
    return s.status(400).json({ success: false, message: 'Choose a valid report date range' }); return s.json({ success: true, message: 'Organization report fetched', data: await (0, report_repository_1.organizationReport)(scope(q), from, to) }); }
