import { Request, Response, NextFunction } from "express";
import { AppError } from "../utils/app-error";
import { logger } from "../utils/logger";

export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const requestId = req.headers["x-request-id"]?.toString();

  if (error instanceof AppError) {
    logger.warn(error.message, {
      requestId,
      path: req.originalUrl,
      statusCode: error.statusCode,
    });

    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      requestId,
    });
  }

  logger.error("Unhandled server error", {
    requestId,
    path: req.originalUrl,
    message: error.message,
    stack: error.stack,
  });

  return res.status(500).json({
    success: false,
    message: "Internal server error",
    requestId,
  });
}
