import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Elm applications pin an exact `elm-version`, and the compiler refuses to build
// when elm.json names any version other than its own. A template's elm.json
// therefore can't hard-code one without dictating a compiler: ask the installed
// compiler what it is instead, and write that into the elm.json we generate, so
// the same template builds under 0.19.1 and 0.19.3 alike.
//
// Resolution mirrors node-elm-compiler: plain `elm` off PATH, which picks up
// node_modules/.bin when invoked through npm or npx. On Windows that is a
// `.cmd` shim, which needs a shell to be found.
export default async function detectElmVersion(): Promise<string | null> {
  try {
    const { stdout } = await run("elm", ["--version"], {
      shell: process.platform === "win32",
    });
    // `elm --version` prints just the version, but only an exact x.y.z is
    // usable as an elm.json `elm-version`, so require that shape.
    return stdout.trim().match(/^\d+\.\d+\.\d+$/)?.[0] ?? null;
  } catch {
    // No compiler on PATH, or it failed to run. Leave elm.json's own
    // `elm-version` alone and let the compile report the real problem.
    return null;
  }
}
