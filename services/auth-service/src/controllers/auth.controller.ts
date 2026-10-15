import { Request, Response } from "express";
import { loginSchema, organizationApplicantRegisterSchema, registerSchema } from "../validators/auth.validator";
import {
  loginUser,
  registerUser,
  getCurrentUser,
  registerOrganizationApplicant,
  refreshUserSession,
} from "../services/auth.service";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export async function register(req: Request, res: Response) {
  try {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input);

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = (error as any).statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Registration failed",
    });
  }
}
export async function refresh(req:Request,res:Response){
  try{const token=typeof req.body?.refreshToken==="string"?req.body.refreshToken:"";if(!token)return res.status(400).json({success:false,message:"Refresh token is required"});const result=await refreshUserSession(token);return res.status(200).json({success:true,message:"Session refreshed",data:result})}catch(error){return res.status((error as any).statusCode||401).json({success:false,message:error instanceof Error?error.message:"Session refresh failed"})}
}

export async function registerApplicant(req:Request,res:Response){
  const result=await registerOrganizationApplicant(organizationApplicantRegisterSchema.parse(req.body));
  return res.status(201).json({success:true,message:"Onboarding account created",data:result});
}

export async function login(req: Request, res: Response) {
  try {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    const statusCode = (error as any).statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Login failed",
    });
  }
}
export async function me(req: AuthenticatedRequest, res: Response) {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await getCurrentUser(userId);

    return res.status(200).json({
      success: true,
      message: "Current user fetched successfully",
      data: result,
    });
  } catch (error) {
    const statusCode = (error as any).statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch user",
    });
  }
}
