"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const platform_user_controller_1 = require("../controllers/platform-user.controller");
const r = (0, express_1.Router)(), run = (h) => async (q, s, n) => { try {
    await h(q, s);
}
catch (e) {
    n(e);
} };
r.use('/platform-users', auth_middleware_1.requireAuth, (0, auth_middleware_1.requireRoles)('system_admin'));
r.get('/platform-users', run(platform_user_controller_1.getPlatformUsers));
r.post('/platform-users', run(platform_user_controller_1.postPlatformUser));
r.patch('/platform-users/:id/status', run(platform_user_controller_1.patchPlatformUserStatus));
exports.default = r;
