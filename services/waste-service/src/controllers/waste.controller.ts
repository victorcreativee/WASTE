import { Request, Response } from "express";
import {
  createDriverSchema,
  createTruckSchema,
  createZoneSchema,
} from "../validators/waste.validator";
import {
  addDriver,
  addTruck,
  addZone,
  listDrivers,
  listTrucks,
  listZones,
} from "../services/waste.service";

export async function getZones(req: Request, res: Response) {
  const zones = await listZones();

  return res.status(200).json({
    success: true,
    message: "Waste zones fetched successfully",
    data: zones,
  });
}

export async function createZoneHandler(req: Request, res: Response) {
  const input = createZoneSchema.parse(req.body);
  const zone = await addZone(input);

  return res.status(201).json({
    success: true,
    message: "Waste zone created successfully",
    data: zone,
  });
}

export async function getTrucks(req: Request, res: Response) {
  const trucks = await listTrucks();

  return res.status(200).json({
    success: true,
    message: "Waste trucks fetched successfully",
    data: trucks,
  });
}

export async function createTruckHandler(req: Request, res: Response) {
  const input = createTruckSchema.parse(req.body);
  const truck = await addTruck(input);

  return res.status(201).json({
    success: true,
    message: "Waste truck created successfully",
    data: truck,
  });
}

export async function getDrivers(req: Request, res: Response) {
  const drivers = await listDrivers();

  return res.status(200).json({
    success: true,
    message: "Drivers fetched successfully",
    data: drivers,
  });
}

export async function createDriverHandler(req: Request, res: Response) {
  const input = createDriverSchema.parse(req.body);
  const driver = await addDriver(input);

  return res.status(201).json({
    success: true,
    message: "Driver created successfully",
    data: driver,
  });
}
