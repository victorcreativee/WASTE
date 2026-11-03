import { companyReport } from '../repositories/company-report.repository';
import { reportRangeSchema } from '../validators/report-range.validator';
import { requireOrganizationScope } from "../middlewares/organization-scope";
import{Request,Response}from'express';import{cityCollectorReport,organizationReport}from'../repositories/report.repository';const scope=requireOrganizationScope;
function range(q:Request){const now=new Date(),to=typeof q.query.to==='string'?q.query.to:now.toISOString().slice(0,10),from=typeof q.query.from==='string'?q.query.from:new Date(now.getFullYear(),now.getMonth(),1).toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Object.assign(new Error('Choose a valid report date range'),{statusCode:400});return{from,to}}
export async function getOrganizationReport(q:Request,s:Response){const{from,to}=range(q);return s.json({success:true,message:'Organization report fetched',data:await organizationReport(scope(q),from,to)});}
export async function getCityCollectorReport(q:Request,s:Response){const{from,to}=range(q);return s.json({success:true,message:'City collector report fetched',data:await cityCollectorReport(from,to)});}

export async function getCompanyReport(req:Request,res:Response){const {from,to}=reportRangeSchema.parse(req.query);res.setHeader("Cache-Control","no-store");return res.json({success:true,message:"Company report generated",data:await companyReport(scope(req),from,to)});}
