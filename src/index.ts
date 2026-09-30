import { startLineAgentServer } from "./app";
import { loadConfig, validateConfig } from "./config";

const config = loadConfig();
validateConfig(config);
const server = startLineAgentServer(config);

console.log(`LINE Agent POC listening on :${server.port}`);
