// Copies non-TypeScript runtime assets into dist/ so the compiled package can
// find them at the same relative paths it uses in development: the Elm support
// module and the bundled default template.
import { cp, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = (p) => path.join(root, "src", p);
const to = (p) => path.join(root, "dist", p);

await cp(from("ExamplePublisher.elm"), to("ExamplePublisher.elm"));
await cp(from("templates"), to("templates"), { recursive: true });

// Make the compiled CLI executable (the shebang alone isn't enough).
await chmod(to("cli.js"), 0o755);

console.log("Copied runtime assets into dist/");
