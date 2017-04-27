#!/usr/bin/env node

var program = require('commander'),
    main = require('./index.js'),
    fs = require('fs'),
    _ = require('lodash');

function templateData(value, object) {
  if (fs.existsSync(value)) {
    return _.merge(object, JSON.parse(fs.readFileSync(value, 'utf8')));
  } else {
    return _.merge(object, JSON.parse(value));
  }
}


program
  .version(require('../package.json').version)
  .arguments('<input-directory> <output-directory>')
  .description('Processes files in the input directory and outputs generated HTML in the output-directory')
  .option('--exclude <glob>', 'Exclude the matching patterns from processing')
  .option('--template-dir <dir>', 'Use this directory to try loading template to render the output')
  .option('--delay <miliseconds>', 'Number of miliseconds to wait before taking screenshots (default = 0)', parseInt)
  .option('--width <pixels>', 'Width of the webpage (default = 990)', parseInt)
  .option('--height <pixels>', 'Height of the webpage (default = 504)', parseInt)
  .option('-d, --template-data <json>', 'Inject data into the template. Default templates support name field. This should be JSON formatted.', templateData, {})
  .parse(process.argv);



main({
  inputDir: program.args[0],
  outputDir: program.args[1],
  exclude: program.exclude,
  templateDir: program.templateDir,
  delay: program.delay,
  width: program.width,
  height: program.height,
  templateData: program.templateData
}).catch(function(e) {
  console.error(e);
  process.exit(1);
});
