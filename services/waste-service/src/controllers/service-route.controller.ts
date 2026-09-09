import {Request,Response} from "express";
import {AuthenticatedRequest} from "../middlewares/auth.middleware";
import {assignServiceRouteCustomersSchema,createServiceRouteSchema,updateServiceRouteSchema} from "../validators/service-route.validator";
import {findAuthorizedDivisions,findDivisionAreaCatalog,findServiceRouteCustomers,findServiceRoutes,insertServiceRoute,replaceServiceRouteCustomers,updateServiceRoute} from "../repositories/service-route.repository";

function identity(req:Request){
  const auth=(req as AuthenticatedRequest).auth;
  if(!auth?.organizationId)throw Object.assign(new Error("Your account must belong to an organization"),{statusCode:403});
  return {organizationId:auth.organizationId,userId:auth.userId};
}

export async function getAuthorizedDivisions(req:Request,res:Response){const {organizationId}=identity(req);return res.json({success:true,message:"Authorized divisions fetched",data:await findAuthorizedDivisions(organizationId)});}
export async function getDivisionAreaCatalog(req:Request,res:Response){const {organizationId}=identity(req);return res.json({success:true,message:"Division areas fetched",data:await findDivisionAreaCatalog(organizationId)});}
export async function getServiceRoutes(req:Request,res:Response){const {organizationId}=identity(req);return res.json({success:true,message:"Service routes fetched",data:await findServiceRoutes(organizationId)});}
export async function postServiceRoute(req:Request,res:Response){const id=identity(req),input=createServiceRouteSchema.parse(req.body);const data=await insertServiceRoute(id.organizationId,id.userId,input);return res.status(201).json({success:true,message:"Route created. Assign customers to make it ready for trips.",data});}
export async function patchServiceRoute(req:Request,res:Response){const {organizationId}=identity(req),input=updateServiceRouteSchema.parse(req.body),data=await updateServiceRoute(organizationId,req.params.id as string,input);if(!data)return res.status(404).json({success:false,message:"Service route not found"});return res.json({success:true,message:"Route updated",data});}
export async function getServiceRouteCustomers(req:Request,res:Response){const {organizationId}=identity(req),data=await findServiceRouteCustomers(organizationId,req.params.id as string);if(!data)return res.status(404).json({success:false,message:"Service route not found"});return res.json({success:true,message:"Route customers fetched",data});}
export async function putServiceRouteCustomers(req:Request,res:Response){const id=identity(req),input=assignServiceRouteCustomersSchema.parse(req.body),data=await replaceServiceRouteCustomers(id.organizationId,id.userId,req.params.id as string,input.serviceLocationIds);if(!data)return res.status(404).json({success:false,message:"Active service route not found"});return res.json({success:true,message:`Route updated with ${data.customerCount} customers`,data});}
