"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAttendance = getAttendance;
exports.putAttendance = putAttendance;
const attendance_validator_1 = require("../validators/attendance.validator");
const attendance_repository_1 = require("../repositories/attendance.repository");
function org(req) { const id = req.user?.organizationId; if (!id) {
    const e = new Error('Account is not linked to an organization');
    e.statusCode = 403;
    throw e;
} return id; }
async function getAttendance(req, res) { const parsed = attendance_validator_1.attendanceDateSchema.safeParse(req.query.date ?? new Date().toISOString().slice(0, 10)); if (!parsed.success)
    return res.status(400).json({ success: false, message: 'Choose a valid attendance date in YYYY-MM-DD format.' }); return res.json({ success: true, message: 'Attendance fetched', data: await (0, attendance_repository_1.findAttendance)(org(req), parsed.data) }); }
async function putAttendance(req, res) { const parsed = attendance_validator_1.attendanceSchema.safeParse(req.body); if (!parsed.success)
    return res.status(400).json({ success: false, message: `Check ${parsed.error.issues[0].path.join('.')}: ${parsed.error.issues[0].message}` }); const data = await (0, attendance_repository_1.saveAttendance)(org(req), req.user.userId, parsed.data); return data ? res.json({ success: true, message: 'Attendance updated', data }) : res.status(404).json({ success: false, message: 'Eligible staff member not found. The staff account and organization membership must both be active.' }); }
