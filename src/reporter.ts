import chalk from "chalk";
import type { BuildEvent, Key, Reporter } from "./borek/index.js";

// Turns a task key into a short human description for progress lines. Only the
// user-meaningful tasks are described; anything else falls back to the method
// name so new tasks still show up (just less prettily).
const describe = (key: Key): string | null => {
  const [arg] = key.args;
  const example =
    arg && typeof arg === "object" && "basename" in arg
      ? String((arg as { basename: unknown }).basename)
      : typeof arg === "string"
        ? arg
        : "";
  // Allowlist: only the user-meaningful milestones get a line. Everything else
  // (gather, parseExample, trackElmModule, prepareTemplate, the per-shot
  // screenshot tasks, …) is plumbing and stays quiet, so the log reads as a
  // list of "what got built" rather than internal task churn.
  switch (key.method) {
    case "buildExamplePage":
      return `built ${example}`;
    case "buildIndexPage":
      return "built index page";
    case "screenshots":
      return `screenshotted ${example}`;
    case "copyAssets":
      return "copied assets";
    default:
      return null;
  }
};

const formatDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

// A plain-line progress reporter: one append-only line per finished task. Works
// identically in an interactive terminal and in a CI log (no escape codes, no
// in-place updates), which is what we want for debuggable build output.
export const createReporter = (): Reporter => {
  return (event: BuildEvent) => {
    const label = describe(event.key);
    if (label === null) return;
    if (event.type === "finish") {
      console.log(
        `  ${chalk.green("✓")} ${label} ${chalk.dim(`(${formatDuration(event.durationMs)})`)}`,
      );
    } else if (event.type === "error") {
      console.log(`  ${chalk.red("✗")} ${label} — ${chalk.red("failed")}`);
    }
  };
};
