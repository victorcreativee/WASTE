"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const regulatory_controller_1 = require("../controllers/regulatory.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const router = (0, express_1.Router)(), run = (handler) => async (req, res, next) => { try {
    await handler(req, res);
}
catch (error) {
    next(error);
} };
router.get('/account-applications/:id/certificate', (0, auth_middleware_1.requireRoles)('system_admin'), run(regulatory_controller_1.downloadAccountApplicationCertificate));
exports.default = router;
