import { startLineAgentServer } from "./bun-server";
import { loadConfig, validateConfig } from "./config";

const config = loadConfig(process.env);
validateConfig(config);
const server = startLineAgentServer(config);

console.log(`Messaging Agent POC listening on :${server.port}`);
