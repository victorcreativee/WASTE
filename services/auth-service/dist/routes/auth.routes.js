"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("../controllers/auth.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)();
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
