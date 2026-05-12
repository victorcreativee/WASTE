import { createClient } from "redis";
import { env } from "./env";

export const redisClient = createClient({
  url: env.redisUrl,
});

redisClient.on("error", (error) => {
  console.error("Redis error:", error);
});

let isRedisConnected = false;

export async function connectRedis() {
  if (!isRedisConnected) {
    await redisClient.connect();
    isRedisConnected = true;
  }
}

export async function checkRedisHealth() {
  await connectRedis();

  const pong = await redisClient.ping();

  return {
    connected: pong === "PONG",
    response: pong,
  };
}
