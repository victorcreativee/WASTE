"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const command_center_controller_1 = require("../controllers/command-center.controller");
const router = (0, express_1.Router)();
router.get("/command-center/summary", async (req, res, next) => {
    try {
        await (0, command_center_controller_1.getCommandCenterSummaryHandler)(req, res);
    }
    catch (error) {
        next(error);
    }
});
exports.default = router;
