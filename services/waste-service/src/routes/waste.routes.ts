import { Router, Request, Response, NextFunction } from "express";
import {
  createDriverHandler,
  createTruckHandler,
  createZoneHandler,
  getDrivers,
  getTrucks,
  getZones,
} from "../controllers/waste.controller";

const router = Router();

router.get(
  "/zones",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getZones(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/zones",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await createZoneHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/trucks",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getTrucks(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/trucks",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await createTruckHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/drivers",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getDrivers(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/drivers",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await createDriverHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

export default router;
