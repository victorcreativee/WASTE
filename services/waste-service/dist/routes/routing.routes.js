"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const routing_controller_1 = require("../controllers/routing.controller");
const router = (0, express_1.Router)();
router.get("/status", async (req, res, next) => {
    try {
        await (0, routing_controller_1.getRoutingStatusHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
