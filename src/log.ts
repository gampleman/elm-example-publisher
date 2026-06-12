import chalk from "chalk";

export function generated(file: string): void {
  console.log("  " + chalk.green("✓") + " " + file);
}

export function heading(str: string): void {
  console.log(chalk.green.bold(str));
}
