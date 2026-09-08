"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymentProvider = getPaymentProvider;
class PendingExternalProvider {
    code;
    constructor(code) {
        this.code = code;
    }
    async initiate() {
        return { status: "pending", providerReference: null, message: "Payment request recorded. External provider confirmation is pending." };
    }
}
function getPaymentProvider(code) {
    return new PendingExternalProvider(code);
}
