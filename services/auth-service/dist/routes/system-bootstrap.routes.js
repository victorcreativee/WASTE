"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const system_bootstrap_repository_1 = require("../repositories/system-bootstrap.repository");
const router = (0, express_1.Router)();
const attempts = new Map();
const schema = zod_1.z.object({
    fullName: zod_1.z.string().trim().min(2).max(150),
    email: zod_1.z.string().trim().email().max(254),
    password: zod_1.z.string()
        .min(12)
        .max(72)
        .refine(password => Buffer.byteLength(password, "utf8") <= 72 &&
        /[a-z]/.test(password) &&
        /[A-Z]/.test(password) &&
        /[0-9]/.test(password) &&
        /[^A-Za-z0-9]/.test(password), "Password must contain uppercase, lowercase, number and symbol"),
    setupToken: zod_1.z.string().regex(/^[a-f0-9]{64}$/i),
}).strict();
router.get("/system-bootstrap/status", async (_req, res, next) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        res.json({
            success: true,
            data: await (0, system_bootstrap_repository_1.systemBootstrapStatus)(),
        });
    }
    catch (error) {
        next(error);
    }
});
router.post("/system-bootstrap", async (req, res, next) => {
    try {
        res.setHeader("Cache-Control", "no-store");
        const key = req.ip || "unknown";
        const now = Date.now();
        const entry = attempts.get(key) || {
            count: 0,
            until: now + 60_000,
        };
        if (entry.until < now) {
            entry.count = 0;
            entry.until = now + 60_000;
        }
        entry.count++;
        attempts.set(key, entry);
        if (entry.count > 5) {
            return res.status(429).json({
                success: false,
                message: "Too many setup attempts",
            });
        }
        const input = schema.parse(req.body);
        const user = await (0, system_bootstrap_repository_1.createFirstSystemAdmin)(input);
        return res.status(201).json({
            success: true,
            message: "System Administrator created successfully",
            data: user,
        });
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
