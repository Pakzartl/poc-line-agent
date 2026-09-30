import { startLineAgentServer } from "./app";
import { loadConfig, validateConfig } from "./config";

const config = loadConfig();
validateConfig(config);
const server = startLineAgentServer(config);

console.log(`Messaging Agent POC listening on :${server.port}`);
