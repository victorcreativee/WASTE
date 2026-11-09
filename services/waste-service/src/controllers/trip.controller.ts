import {Request,Response} from "express";import {AuthenticatedRequest} from "../middlewares/auth.middleware";import {createTripSchema,verifyTripWeightSchema} from "../validators/trip.validator";import {createTrip,findOperationalSupervisors,findTrips,verifyTripWeight} from "../repositories/trip.repository";import {tripAlerts} from "../repositories/trip-alert.repository";
export async function getTrips(req:Request,res:Response){const auth=(req as AuthenticatedRequest).auth!,scope=auth.roles.some(role=>["company_admin","supervisor"].includes(role))?auth.organizationId:null;return res.json({success:true,message:"Trips fetched",data:await findTrips(scope)});}
export async function getOperationalSupervisors(req:Request,res:Response){const auth=(req as AuthenticatedRequest).auth!;if(!auth.organizationId)return res.status(403).json({success:false,message:"An organization account is required"});return res.json({success:true,message:"Operational supervisors fetched",data:await findOperationalSupervisors(auth.organizationId)});}
export async function postTrip(req:Request,res:Response){const auth=(req as AuthenticatedRequest).auth!;if(!auth.organizationId)return res.status(403).json({success:false,message:"An organization account is required"});const data=await createTrip(auth.organizationId,auth.userId,createTripSchema.parse(req.body));return res.status(201).json({success:true,message:`${data.trip_number} created with ${data.customer_count} customers`,data});}
export async function patchTripWeight(req:Request,res:Response){const auth=(req as AuthenticatedRequest).auth!;if(!auth.organizationId)return res.status(403).json({success:false,message:"An organization account is required"});const data=await verifyTripWeight(req.params.tripId as string,auth.organizationId,auth.userId,verifyTripWeightSchema.parse(req.body));return res.json({success:true,message:"Weighbridge ticket recorded; it counts as verified once KCCA's weighbridge record is linked",data});}

/** Late and stuck trips. A company sees its own; a supervisor only the trips they supervise; KCCA the whole city. */
export async function getTripAlerts(req:Request,res:Response){
 const auth=(req as AuthenticatedRequest).auth!,company=auth.roles.some(role=>["company_admin","supervisor"].includes(role));
 if(company&&!auth.organizationId)return res.status(403).json({success:false,message:"An organization account is required"});
 const supervisorOnly=company&&!auth.roles.includes("company_admin");
 res.setHeader("Cache-Control","no-store");
 return res.json({success:true,message:"Trip alerts fetched",data:await tripAlerts(company?auth.organizationId:null,supervisorOnly?auth.userId:null)});
}
