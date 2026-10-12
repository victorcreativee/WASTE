import { Request, Response } from "express";
import { env } from "../config/env";
import { checkDatabaseHealth } from "../config/database";
import { checkRedisHealth } from "../config/redis";

export async function healthCheck(req: Request, res: Response) {
  async function serviceHealth(name:string,url:string){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2500);
    try{
      const response=await fetch(url,{signal:controller.signal,headers:{accept:"application/json"}});
      return {status:response.ok?"healthy":"unhealthy",service:name,httpStatus:response.status};
    }catch{
      return {status:"unhealthy",service:name,httpStatus:null};
    }finally{clearTimeout(timer)}
  }
  const checks = {
    apiGateway: {
      status: "healthy",
      service: env.serviceName,
    },
    database: {
      status: "unknown",
      details: null as unknown,
    },
    redis: {
      status: "unknown",
      details: null as unknown,
    },
    authService: {status:"unknown",service:"auth-service",httpStatus:null as number|null},
    organizationService: {status:"unknown",service:"organization-service",httpStatus:null as number|null},
    wasteService: {status:"unknown",service:"waste-service",httpStatus:null as number|null},
  };

  let overallStatus = "healthy";

  try {
    checks.database.details = await checkDatabaseHealth();
    checks.database.status = "healthy";
  } catch (error) {
    overallStatus = "degraded";
    checks.database.status = "unhealthy";
    checks.database.details = {
      message:
        error instanceof Error ? error.message : "Database health check failed",
    };
  }

  const [authService,organizationService,wasteService]=await Promise.all([
    serviceHealth("auth-service",`${env.authServiceUrl}/api/auth/health`),
    serviceHealth("organization-service",`${env.organizationServiceUrl}/api/organizations/health`),
    serviceHealth("waste-service",`${env.wasteServiceUrl}/api/waste/health`),
  ]);
  checks.authService=authService;
  checks.organizationService=organizationService;
  checks.wasteService=wasteService;
  if([authService,organizationService,wasteService].some(check=>check.status!=="healthy"))overallStatus="degraded";

  try {
    checks.redis.details = await checkRedisHealth();
    checks.redis.status = "healthy";
  } catch (error) {
    overallStatus = "degraded";
    checks.redis.status = "unhealthy";
    checks.redis.details = {
      message:
        error instanceof Error ? error.message : "Redis health check failed",
    };
  }

  return res.status(overallStatus === "healthy" ? 200 : 503).json({
    success: overallStatus === "healthy",
    message:
      overallStatus === "healthy"
        ? "Platform dependencies are healthy"
        : "Platform health is degraded",
    service: env.serviceName,
    status: overallStatus,
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    requestId: req.headers["x-request-id"],
    checks,
  });
}
