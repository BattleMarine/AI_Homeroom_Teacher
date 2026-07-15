import { buildApp } from "./app.js";
import { getApiServerConfig } from "./config.js";

const app = buildApp();
const config = getApiServerConfig();

try {
  await app.listen(config);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
