import chalk from "chalk";

export function generated(file) {
  console.log("  " + chalk.green("✓") + " " + file);
}

export function heading(str) {
  console.log(chalk.green.bold(str));
}
