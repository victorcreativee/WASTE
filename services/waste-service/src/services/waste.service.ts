import {
  assignCollectionJob,
  createCollectionJob,
  createDriver,
  createPickupSchedule,
  createTruck,
  createZone,
  findCollectionJobs,
  findDrivers,
  findPickupSchedules,
  findTrucks,
  findZones,
  generateCollectionJobsFromSchedule,
  updateCollectionJobStatus,
} from "../repositories/waste.repository";
import {
  AssignCollectionJobInput,
  CreateCollectionJobInput,
  CreateDriverInput,
  CreatePickupScheduleInput,
  CreateTruckInput,
  CreateZoneInput,
  GenerateCollectionJobsInput,
  UpdateCollectionJobStatusInput,
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
export async function listPickupSchedules() {
  return findPickupSchedules();
}

export async function addPickupSchedule(input: CreatePickupScheduleInput) {
  return createPickupSchedule(input);
}

export async function listCollectionJobs() {
  return findCollectionJobs();
}

export async function addCollectionJob(input: CreateCollectionJobInput) {
  return createCollectionJob(input);
}

export async function changeCollectionJobStatus(
  jobId: string,
  input: UpdateCollectionJobStatusInput
) {
  return updateCollectionJobStatus(jobId, input);
}
export async function generateJobsForPickupSchedule(
  scheduleId: string,
  input: GenerateCollectionJobsInput
) {
  return generateCollectionJobsFromSchedule(scheduleId, input);
}
export async function assignTruckAndDriverToJob(
  jobId: string,
  input: AssignCollectionJobInput
) {
  return assignCollectionJob(jobId, input);
}
