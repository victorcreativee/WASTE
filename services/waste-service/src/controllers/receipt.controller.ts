import { Request, Response } from "express";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { parsePage, sendList } from "../utils/pagination";
import * as repo from "../repositories/receipt.repository";
import { receiptSigningKey } from "../services/receipt-signing";
import { operatorCodeSchema, receiptListQuerySchema, receiptVoidSchema, serialFormatSchema, serialParamSchema } from "../validators/receipt.validator";

const auth = (req: Request) => (req as AuthenticatedRequest).auth!;
const isRegulator = (roles: string[]) => roles.includes("kcca_admin") || roles.includes("system_admin");

/** Companies see their own receipts, households theirs, KCCA every operator's (optionally one). */
function scope(req: Request, organizationId?: string) {
  const a = auth(req);
  if (isRegulator(a.roles)) return { organizationId: organizationId ?? null, customerUserId: null };
  if (a.roles.includes("citizen")) return { organizationId: null, customerUserId: a.userId };
  return { organizationId: a.organizationId, customerUserId: null };
}

export async function getReceipts(req: Request, res: Response) {
  const query = receiptListQuerySchema.parse(req.query), page = parsePage(req.query);
  return sendList(res, "Collection receipts fetched", await repo.listReceipts({ ...query, ...scope(req, query.organizationId) }, page), page);
}

export async function getReceiptSummary(req: Request, res: Response) {
  return res.json({ success: true, message: "Receipt summary fetched", data: await repo.receiptSummary(auth(req).organizationId!) });
}

export async function postReceiptVoid(req: Request, res: Response) {
  const a = auth(req), { reason } = receiptVoidSchema.parse(req.body);
  const data = await repo.voidReceipt(req.params.id as string, a.organizationId!, a.userId, reason);
  return res.status(201).json({ success: true, message: `Receipt ${data.serial_number} voided`, data });
}

export async function getOwnChainCheck(req: Request, res: Response) {
  return res.json({ success: true, message: "Receipt chain checked", data: await repo.verifyChain(auth(req).organizationId!) });
}

export async function getExports(req: Request, res: Response) {
  const a = auth(req), page = parsePage(req.query);
  const organizationId = isRegulator(a.roles) ? (typeof req.query.organizationId === "string" ? req.query.organizationId : null) : a.organizationId;
  return sendList(res, "Receipt exports fetched", await repo.listExports(organizationId, page), page);
}

/** The signed export as a file: the exact signed JSON, with the signature and key alongside in headers. */
export async function downloadExport(req: Request, res: Response) {
  const a = auth(req), row = await repo.findExport(req.params.id as string, isRegulator(a.roles) ? null : a.organizationId);
  if (!row) return res.status(404).json({ success: false, message: "Export not found" });
  const date = row.export_date as string;
  if (req.query.part === "signature") {
    res.setHeader("Content-Disposition", `attachment; filename="receipts-${row.organization_id}-${date}.sig.json"`);
    return res.json({ file: `receipts-${row.organization_id}-${date}.json`, algorithm: "Ed25519", sha256: row.content_sha256,
      signature: row.signature, keyId: row.signing_key_id, publicKey: row.signing_public_key });
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="receipts-${row.organization_id}-${date}.json"`);
  res.setHeader("X-Content-SHA256", row.content_sha256);
  res.setHeader("X-Signature-Ed25519", row.signature);
  res.setHeader("X-Signing-Key-Id", row.signing_key_id);
  return res.send(row.content);
}

export async function getCityOperators(_req: Request, res: Response) {
  return res.json({ success: true, message: "Receipting operators fetched", data: await repo.cityReceiptOperators() });
}

export async function getOperatorChainCheck(req: Request, res: Response) {
  return res.json({ success: true, message: "Receipt chain checked", data: await repo.verifyChain(req.params.organizationId as string) });
}

export async function putOperatorCode(req: Request, res: Response) {
  const { code } = operatorCodeSchema.parse(req.body);
  return res.json({ success: true, message: `Receipt code set to ${code}`, data: await repo.setOperatorCode(req.params.organizationId as string, code, auth(req).userId) });
}

export async function getSettings(_req: Request, res: Response) {
  return res.json({ success: true, message: "Receipt settings fetched", data: await repo.getReceiptSettings() });
}

export async function putSettings(req: Request, res: Response) {
  const { serialFormat } = serialFormatSchema.parse(req.body);
  return res.json({ success: true, message: "Serial format saved", data: await repo.updateSerialFormat(serialFormat, auth(req).userId) });
}

export async function getPublicReceipt(req: Request, res: Response) {
  const serial = serialParamSchema.safeParse(req.params.serial);
  const data = serial.success ? await repo.findPublicReceipt(serial.data) : null;
  if (!data) return res.status(404).json({ success: false, message: "No receipt has this number" });
  return res.json({ success: true, message: "Receipt found", data });
}

export async function getPublicSigningKey(_req: Request, res: Response) {
  const key = receiptSigningKey();
  return res.json({ success: true, message: "Receipt export signing key", data: { keyId: key.keyId, algorithm: "Ed25519", publicKey: key.publicKeyPem, development: key.development } });
}
