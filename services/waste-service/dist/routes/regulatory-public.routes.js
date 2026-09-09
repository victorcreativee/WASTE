"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const regulatory_controller_1 = require("../controllers/regulatory.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
const attempts = new Map();
r.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); const now = Date.now(), key = req.ip || 'unknown'; for (const [ip, value] of attempts)
    if (value.until <= now)
        attempts.delete(ip); const current = attempts.get(key) || { count: 0, until: now + 60000 }; current.count++; attempts.set(key, current); if (current.count > 30 || attempts.size > 10000)
    return res.status(429).json({ success: false, message: 'Too many onboarding requests. Wait one minute and try again.' }); next(); });
r.post('/permit-applications', run(regulatory_controller_1.postPermit));
r.post('/permit-applications/status', run(regulatory_controller_1.getPublicPermitStatus));
r.post('/permit-applications/information', run(regulatory_controller_1.postPermitInformation));
r.get('/permit-certificates/:id', run(regulatory_controller_1.downloadPermitCertificate));
r.get('/platform-packages', run(regulatory_controller_1.getPlatformPackages));
r.post('/account-applications', run(regulatory_controller_1.postAccountApplication));
exports.default = r;
