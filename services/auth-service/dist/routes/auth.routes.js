"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
const applicantAttempts = new Map();
router.post("/organization-applicants/register", (req, res, next) => { const now = Date.now(), key = req.ip || "unknown"; for (const [ip, value] of applicantAttempts)
    if (value.until <= now)
        applicantAttempts.delete(ip); const value = applicantAttempts.get(key) || { count: 0, until: now + 60000 }; value.count++; applicantAttempts.set(key, value); if (value.count > 5)
    return res.status(429).json({ success: false, message: "Too many registration attempts. Wait one minute and try again." }); next(); }, async (req, res, next) => { try {
    await (0, auth_controller_1.registerApplicant)(req, res);
}
catch (error) {
    next(error);
} });
router.post("/register", async (req, res, next) => {
    try {
        await (0, auth_controller_1.register)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.post("/login", async (req, res, next) => {
    try {
        await (0, auth_controller_1.login)(req, res);
    }
    catch (error) {
        next(error);
    }
});
router.get("/me", auth_middleware_1.requireAuth, async (req, res, next) => {
    try {
        await (0, auth_controller_1.me)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
