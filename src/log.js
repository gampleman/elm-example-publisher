const chalk = require("chalk"),
  path = require("path");
module.exports = {
  generated(file) {
    console.log("  " + chalk.green("✓") + " " + file);
  },
  heading(str) {
    console.log(chalk.green.bold(str));
  },
};
