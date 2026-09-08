"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const onboarding_repository_1 = require("../repositories/onboarding.repository");
const router = (0, express_1.Router)();
// Disabled until migration 025 and acceptance checks have been completed for this environment.
router.use('/organization-onboarding', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (process.env.WMS_ONBOARDING_ENABLED !== 'true')
        return res.status(503).json({ success: false, message: 'Company onboarding is not enabled. Apply migration 025 and complete setup checks first.' });
    next();
});
const run = (fn) => async (req, res, next) => { try {
    await fn(req, res);
}
catch (error) {
    next(error);
} };
const email = zod_1.z.string().trim().email().max(254);
// Conservative process-local throttle. Multi-instance production requires a shared rate limiter.
const attempts = new Map();
router.post('/organization-onboarding/accept', (req, res, next) => {
    const now = Date.now(), key = req.ip || 'unknown';
    for (const [ip, entry] of attempts)
        if (entry.until <= now)
            attempts.delete(ip);
    const entry = attempts.get(key) || { count: 0, until: now + 60000 };
    entry.count++;
    attempts.set(key, entry);
    if (entry.count > 5 || attempts.size > 10000)
        return res.status(429).json({ success: false, message: 'Too many setup attempts. Wait one minute and try again.' });
    next();
}, run(async (req, res) => {
    const body = zod_1.z.object({ token: zod_1.z.string().regex(/^[a-f0-9]{64}$/), email, fullName: zod_1.z.string().trim().min(2).max(150), password: zod_1.z.string().min(12).max(72).refine(p => Buffer.byteLength(p, 'utf8') <= 72, 'Password must be at most 72 bytes') }).strict().parse(req.body);
    res.status(201).json({ success: true, ...await (0, onboarding_repository_1.acceptAdminInvitation)(body.token, body.email, body.fullName, body.password) });
}));
router.use('/organization-onboarding', auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRoles)('system_admin'));
router.get('/organization-onboarding/:organizationId', run(async (req, res) => res.json({ success: true, data: await (0, onboarding_repository_1.onboardingStatus)(zod_1.z.string().uuid().parse(req.params.organizationId)) })));
router.post('/organization-onboarding/:organizationId/invitations', run(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.organizationId), body = zod_1.z.object({ email }).strict().parse(req.body);
    res.status(201).json({ success: true, data: await (0, onboarding_repository_1.issueAdminInvitation)(id, req.user.userId, body.email) });
}));
router.delete('/organization-onboarding/:organizationId/invitations/:invitationId', run(async (req, res) => res.json({ success: true, data: await (0, onboarding_repository_1.revokeAdminInvitation)(zod_1.z.string().uuid().parse(req.params.organizationId), req.user.userId, zod_1.z.string().uuid().parse(req.params.invitationId)) })));
exports.default = router;
