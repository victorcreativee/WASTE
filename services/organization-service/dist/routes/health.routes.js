"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const health_controller_1 = require("../controllers/health.controller");
const router = (0, express_1.Router)();
router.get("/health", async (req, res, next) => {
    try {
        await (0, health_controller_1.healthCheck)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
