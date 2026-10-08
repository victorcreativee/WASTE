"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.postPermit = postPermit;
exports.postApplicantPermit = postApplicantPermit;
exports.getApplicantPermits = getApplicantPermits;
exports.getApplicantProfile = getApplicantProfile;
exports.postApplicantInformation = postApplicantInformation;
exports.postApplicantAccountApplication = postApplicantAccountApplication;
exports.getApplicantAccountApplications = getApplicantAccountApplications;
exports.getPublicPermitStatus = getPublicPermitStatus;
exports.postPermitInformation = postPermitInformation;
exports.getPermits = getPermits;
exports.getDivisions = getDivisions;
exports.getDivisionAuthorizations = getDivisionAuthorizations;
exports.getPlatformPackages = getPlatformPackages;
exports.getAllPlatformPackages = getAllPlatformPackages;
exports.postPlatformPackage = postPlatformPackage;
exports.patchPlatformPackage = patchPlatformPackage;
exports.postAccountApplication = postAccountApplication;
exports.getAccountApplications = getAccountApplications;
exports.patchAccountApplication = patchAccountApplication;
exports.downloadAccountApplicationCertificate = downloadAccountApplicationCertificate;
exports.patchPermit = patchPermit;
exports.postAuthorizations = postAuthorizations;
exports.downloadPermitCertificate = downloadPermitCertificate;
exports.getOrganizationCertificate = getOrganizationCertificate;
exports.downloadOrganizationCertificate = downloadOrganizationCertificate;
exports.downloadApplicantCertificate = downloadApplicantCertificate;
const repo = __importStar(require("../repositories/regulatory.repository"));
const regulatory_validator_1 = require("../validators/regulatory.validator");
async function postPermit(req, res) { return res.status(201).json({ success: true, message: 'Permit application submitted to KCCA', data: await repo.submitPermit(regulatory_validator_1.permitApplicationSchema.parse(req.body)) }); }
async function postApplicantPermit(req, res) { const auth = req.auth; return res.status(201).json({ success: true, message: 'Permit application submitted to KCCA', data: await repo.submitAuthenticatedPermit(auth.userId, regulatory_validator_1.applicantPermitSubmissionSchema.parse(req.body)) }); }
async function getApplicantPermits(req, res) { const auth = req.auth; return res.json({ success: true, message: 'Applicant permits fetched', data: await repo.applicantPermits(auth.userId) }); }
async function getApplicantProfile(req, res) { const auth = req.auth, data = await repo.applicantProfile(auth.userId); return data ? res.json({ success: true, message: 'Applicant profile fetched', data }) : res.status(404).json({ success: false, message: 'Applicant profile not found' }); }
async function postApplicantInformation(req, res) { const auth = req.auth; return res.json({ success: true, message: 'Requested evidence sent to KCCA', data: await repo.provideAuthenticatedPermitInformation(auth.userId, regulatory_validator_1.applicantInformationSubmissionSchema.parse(req.body)) }); }
async function postApplicantAccountApplication(req, res) { const auth = req.auth; return res.status(201).json({ success: true, message: 'Platform-access application submitted', data: await repo.submitAuthenticatedAccountApplication(auth.userId, regulatory_validator_1.applicantAccountSubmissionSchema.parse(req.body)) }); }
async function getApplicantAccountApplications(req, res) { const auth = req.auth; return res.json({ success: true, message: 'Platform-access applications fetched', data: await repo.applicantAccountApplications(auth.userId) }); }
async function getPublicPermitStatus(req, res) { const input = regulatory_validator_1.permitStatusLookupSchema.parse(req.body), data = await repo.publicPermitStatus(input.applicationNumber, input.accessToken); return data ? res.json({ success: true, message: 'Permit status fetched', data }) : res.status(404).json({ success: false, message: 'Application reference or access token is invalid' }); }
async function postPermitInformation(req, res) { return res.json({ success: true, message: 'Information sent to KCCA for review', data: await repo.providePermitInformation(regulatory_validator_1.permitInformationSchema.parse(req.body)) }); }
async function getPermits(req, res) { return res.json({ success: true, message: 'Permit applications fetched', data: await repo.permits(typeof req.query.status === 'string' ? req.query.status : undefined) }); }
async function getDivisions(req, res) { return res.json({ success: true, message: 'Kampala divisions fetched', data: await repo.divisions() }); }
async function getDivisionAuthorizations(_req, res) { return res.json({ success: true, message: 'Division authorizations fetched', data: await repo.divisionAuthorizations() }); }
async function getPlatformPackages(req, res) { const type = typeof req.query.organizationType === 'string' ? req.query.organizationType : undefined; return res.json({ success: true, message: 'Platform packages fetched', data: await repo.platformPackages(type) }); }
async function getAllPlatformPackages(_req, res) { return res.json({ success: true, message: 'Platform packages fetched', data: await repo.allPlatformPackages() }); }
async function postPlatformPackage(req, res) { const auth = req.auth; return res.status(201).json({ success: true, message: 'Platform package created', data: await repo.createPlatformPackage(auth.userId, regulatory_validator_1.platformPackageCreateSchema.parse(req.body)) }); }
async function patchPlatformPackage(req, res) { const auth = req.auth; return res.json({ success: true, message: 'Platform package updated', data: await repo.updatePlatformPackage(req.params.id, auth.userId, regulatory_validator_1.platformPackageUpdateSchema.parse(req.body)) }); }
async function postAccountApplication(req, res) { return res.status(201).json({ success: true, message: 'Account application submitted for System Admin approval', data: await repo.submitAccountApplication(regulatory_validator_1.accountApplicationSchema.parse(req.body)) }); }
async function getAccountApplications(_req, res) { return res.json({ success: true, message: 'Account applications fetched', data: await repo.accountApplications() }); }
async function patchAccountApplication(req, res) { const auth = req.auth, id = req.params.id, input = regulatory_validator_1.accountReviewSchema.parse(req.body); if (input.action === 'approve' && !(await repo.accountApplicationCertificate(id))?.certificate_file_data)
    return res.status(409).json({ success: false, message: 'Review the uploaded KCCA certificate before approval' }); return res.json({ success: true, message: 'Account application updated', data: await repo.reviewAccountApplication(id, auth.userId, input) }); }
async function downloadAccountApplicationCertificate(req, res) { const document = await repo.accountApplicationCertificate(req.params.id); if (!document?.certificate_file_data)
    return res.status(404).json({ success: false, message: 'Verification certificate not found' }); const match = String(document.certificate_file_data).match(/^data:(application\/pdf|image\/jpeg);base64,(.+)$/); if (!match)
    return res.status(422).json({ success: false, message: 'Stored verification certificate is invalid' }); res.setHeader('Content-Type', match[1]); res.setHeader('Content-Disposition', `inline; filename="${String(document.certificate_file_name).replace(/["\r\n]/g, '')}"`); res.setHeader('Cache-Control', 'private, no-store'); return res.send(Buffer.from(match[2], 'base64')); }
async function patchPermit(req, res) { const a = req.auth, input = regulatory_validator_1.permitReviewSchema.parse(req.body), id = req.params.id; if (['approve', 'renew'].includes(input.action) && !input.validUntil)
    return res.status(400).json({ success: false, message: 'Choose the permit validity date before approval' }); if (input.validUntil && input.validUntil <= new Date().toISOString().slice(0, 10))
    return res.status(400).json({ success: false, message: 'Permit validity must be a future date' }); const current = await repo.permitStatusById(id); if (current === 'submitted' && ['approve', 'reject', 'request_information'].includes(input.action))
    await repo.reviewPermit(id, a.userId, { action: 'start_review', notes: 'Review opened with decision' }); const data = await repo.reviewPermit(id, a.userId, input); return data ? res.json({ success: true, message: 'Permit review recorded', data }) : res.status(404).json({ success: false, message: 'Permit application not found' }); }
async function postAuthorizations(req, res) { const a = req.auth; return res.status(201).json({ success: true, message: 'Authorized divisions updated', data: await repo.authorizeDivisions(a.userId, regulatory_validator_1.divisionAuthorizationSchema.parse(req.body)) }); }
function certificatePdf(permit) { const safe = (value) => String(value ?? '').replace(/[^\x20-\x7E]/g, ' ').replace(/[()\\]/g, c => `\\${c}`); const lines = ['URBAN WASTE MANAGEMENT OPERATING SYSTEM', 'KAMPALA CAPITAL CITY AUTHORITY', 'WASTE COLLECTION PERMIT CERTIFICATE', '', `Permit number: ${permit.permit_number}`, `Licensed collector: ${permit.company_name}`, `Registration number: ${permit.registration_number}`, `Valid from: ${permit.valid_from}`, `Valid until: ${permit.valid_until}`, '', `Approved by: ${permit.approved_by_name || 'KCCA'}`, `Verification reference: ${permit.id}`, '', 'This certificate confirms KCCA regulatory approval.', 'Platform account activation requires separate System Admin approval.']; const stream = `BT /F1 20 Tf 70 760 Td (${safe(lines[0])}) Tj /F1 12 Tf 0 -32 Td ${lines.slice(1).map((line) => `(${safe(line)}) Tj 0 -24 Td`).join(' ')} ET`; const objects = [null, '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']; let pdf = '%PDF-1.4\n', offsets = [0]; for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(pdf);
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
} const xref = Buffer.byteLength(pdf); pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(pdf); }
async function downloadPermitCertificate(req, res) { const token = String(req.headers['x-permit-access-token'] || ''); if (!/^[a-f0-9]{64}$/.test(token))
    return res.status(401).json({ success: false, message: 'Permit access token is required' }); const permit = await repo.approvedPermitCertificate(req.params.id, token); if (!permit)
    return res.status(404).json({ success: false, message: 'Approved permit certificate not found' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${permit.permit_number}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); return res.send(certificatePdf(permit)); }
async function getOrganizationCertificate(req, res) { const organizationId = req.auth.organizationId; if (!organizationId)
    return res.status(403).json({ success: false, message: 'Your account is not linked to an organization' }); return res.json({ success: true, message: 'Organization certificate fetched', data: await repo.organizationCertificate(organizationId) }); }
async function downloadOrganizationCertificate(req, res) { const organizationId = req.auth.organizationId; if (!organizationId)
    return res.status(403).json({ success: false, message: 'Your account is not linked to an organization' }); const permit = await repo.organizationCertificate(organizationId); if (!permit)
    return res.status(404).json({ success: false, message: 'No active KCCA certificate is available for this organization' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${permit.permit_number}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); return res.send(certificatePdf(permit)); }
async function downloadApplicantCertificate(req, res) { const auth = req.auth, permit = await repo.applicantCertificate(auth.userId, req.params.id); if (!permit)
    return res.status(404).json({ success: false, message: 'Approved certificate not found' }); res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${permit.permit_number}.pdf"`); res.setHeader('Cache-Control', 'private, no-store'); return res.send(certificatePdf(permit)); }
