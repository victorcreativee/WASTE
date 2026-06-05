import { Router, Request, Response, NextFunction } from "express";
import {
  assignCollectionJobHandler,
  createCollectionJobHandler,
  createDriverHandler,
  createPickupScheduleHandler,
  createTruckHandler,
  createZoneHandler,
  generateCollectionJobsHandler,
  getCollectionJobs,
  getDrivers,
  getPickupSchedules,
  getTrucks,
  getZones,
  updateCollectionJobStatusHandler,
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
router.get(
  "/pickup-schedules",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getPickupSchedules(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/pickup-schedules",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await createPickupScheduleHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/collection-jobs",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await getCollectionJobs(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/collection-jobs",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await createCollectionJobHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/collection-jobs/:id/status",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await updateCollectionJobStatusHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);
router.patch(
  "/collection-jobs/:id/assign",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await assignCollectionJobHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);
router.post(
  "/pickup-schedules/:id/generate-jobs",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await generateCollectionJobsHandler(req, res);
    } catch (error) {
      next(error);
    }
  }
);
export default router;
