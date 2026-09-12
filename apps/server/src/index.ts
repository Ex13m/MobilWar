import { config } from "./config.js";
import { log } from "./log.js";
import { createApp } from "./server.js";

const app = createApp();
app.http.listen(config.port, () => log.info(`MobilWar server on :${config.port}`));

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log.info("shutdown", sig);
    app.close();
    process.exit(0);
  });
}
