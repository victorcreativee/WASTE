import app from "./app";
import { env } from "./config/env";

app.listen(env.port, () => {
  console.log(`🚛 ${env.serviceName} running on port ${env.port}`);
});
