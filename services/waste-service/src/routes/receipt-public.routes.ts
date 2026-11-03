import { NextFunction, Request, Response, Router } from "express";
import { getPublicReceipt, getPublicSigningKey } from "../controllers/receipt.controller";

const r = Router();
const run = (handler: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);

r.get("/receipts/signing-key", run(getPublicSigningKey));
r.get("/receipts/:serial", run(getPublicReceipt));

export default r;
