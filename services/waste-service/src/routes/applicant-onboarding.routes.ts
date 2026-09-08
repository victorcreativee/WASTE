import {NextFunction,Request,Response,Router} from 'express';
import {getApplicantAccountApplications,postApplicantAccountApplication,postApplicantInformation} from '../controllers/regulatory.controller';
import {requireRoles} from '../middlewares/auth.middleware';
const router=Router(),run=(handler:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{try{await handler(req,res)}catch(error){next(error)}};
const applicantOnly=requireRoles('organization_applicant');
router.post('/applicant/permit-information',applicantOnly,run(postApplicantInformation));
router.get('/applicant/account-applications',applicantOnly,run(getApplicantAccountApplications));
router.post('/applicant/account-applications',applicantOnly,run(postApplicantAccountApplication));
export default router;
