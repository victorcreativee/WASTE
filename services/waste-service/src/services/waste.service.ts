import {
  createDriver,
  createTruck,
  createZone,
  findDrivers,
  findTrucks,
  findZones,
} from "../repositories/waste.repository";
import {
  CreateDriverInput,
  CreateTruckInput,
  CreateZoneInput,
} from "../validators/waste.validator";

export async function listZones() {
  return findZones();
}

export async function addZone(input: CreateZoneInput) {
  return createZone(input);
}

export async function listTrucks() {
  return findTrucks();
}

export async function addTruck(input: CreateTruckInput) {
  return createTruck(input);
}

export async function listDrivers() {
  return findDrivers();
}

export async function addDriver(input: CreateDriverInput) {
  return createDriver(input);
}
