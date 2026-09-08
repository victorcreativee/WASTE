import{NextFunction,Request,Response,Router}from'express';import{requireRoles}from'../middlewares/auth.middleware';import{getCustomerStops,patchCustomerStop,patchCustomerStopException,postCustomerStops}from'../controllers/customer-stop.controller';
const r=Router(),run=(h:(q:Request,s:Response)=>Promise<unknown>)=>async(q:Request,s:Response,n:NextFunction)=>{try{await h(q,s)}catch(e){n(e)}};
r.get('/customer-collection-stops',requireRoles('citizen','company_admin','supervisor'),run(getCustomerStops));
r.post('/collection-jobs/:jobId/customer-stops',requireRoles('company_admin','supervisor'),run(postCustomerStops));
r.patch('/customer-collection-stops/:id',requireRoles('driver'),run(patchCustomerStop));export default r;
r.patch('/customer-collection-stops/:id/exception',requireRoles('company_admin','supervisor'),run(patchCustomerStopException));
