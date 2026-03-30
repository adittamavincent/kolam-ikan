import { pathToFileURL } from "node:url";
import { main } from "./provider-bridge-runner.mjs";

export * from "./provider-bridge-runner.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[bridge-runner] fatal", error);
    process.exitCode = 1;
  });
}
