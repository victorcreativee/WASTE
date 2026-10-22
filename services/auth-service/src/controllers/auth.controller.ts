import { Request, Response } from "express";
import { changePasswordSchema, loginSchema, organizationApplicantRegisterSchema, registerSchema } from "../validators/auth.validator";
import {
  loginUser,
  registerUser,
  getCurrentUser,
  registerOrganizationApplicant,
  refreshUserSession,
  logoutSession,
  changeUserPassword,
} from "../services/auth.service";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

const sessionMeta = (req: Request) => ({ userAgent: req.headers["user-agent"] ?? null, ipAddress: req.ip ?? null });

export async function register(req: Request, res: Response) {
  try {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input, sessionMeta(req));

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: result,
    });
  } catch (error) {
    if (!(error as { statusCode?: number })?.statusCode) throw error; // unexpected: central handler logs it and returns a safe 500
    const statusCode = (error as any).statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Registration failed",
    });
  }
}
export async function refresh(req:Request,res:Response){
  try{const token=typeof req.body?.refreshToken==="string"?req.body.refreshToken:"";if(!token)return res.status(400).json({success:false,message:"Refresh token is required"});const result=await refreshUserSession(token,sessionMeta(req));return res.status(200).json({success:true,message:"Session refreshed",data:result})}catch(error){if (!(error as { statusCode?: number })?.statusCode) throw error; // unexpected: central handler logs it and returns a safe 500
return res.status((error as any).statusCode||401).json({success:false,message:error instanceof Error?error.message:"Session refresh failed"})}
}

export async function registerApplicant(req:Request,res:Response){
  const result=await registerOrganizationApplicant(organizationApplicantRegisterSchema.parse(req.body),sessionMeta(req));
  return res.status(201).json({success:true,message:"Onboarding account created",data:result});
}

export async function login(req: Request, res: Response) {
  try {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input, sessionMeta(req));

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    if (!(error as { statusCode?: number })?.statusCode) throw error; // unexpected: central handler logs it and returns a safe 500
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
    if (!(error as { statusCode?: number })?.statusCode) throw error; // unexpected: central handler logs it and returns a safe 500
    const statusCode = (error as any).statusCode || 400;

    return res.status(statusCode).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to fetch user",
    });
  }
}
export async function changePassword(req:AuthenticatedRequest,res:Response){const userId=req.user?.userId;if(!userId)return res.status(401).json({success:false,message:"Unauthorized"});const input=changePasswordSchema.parse(req.body);await changeUserPassword(userId,input.currentPassword,input.newPassword,(req.user as {sid?:string}|undefined)?.sid);return res.json({success:true,message:"Password changed. Every other signed-in device has been signed out."});}

export async function logout(req: Request, res: Response) {
  const header = req.headers.authorization;
  const result = await logoutSession({
    accessToken: header?.startsWith("Bearer ") ? header.slice(7) : undefined,
    refreshToken: typeof req.body?.refreshToken === "string" ? req.body.refreshToken : undefined,
    everywhere: req.body?.everywhere === true,
  });
  return res.json({ success: true, message: req.body?.everywhere === true ? "Signed out on every device" : "Signed out", data: result });
}
