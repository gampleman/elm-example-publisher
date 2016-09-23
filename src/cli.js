#!/usr/bin/env node

var program = require('commander'),
    main = require('./index.js');



program
  .version(require('../package.json').version)
  .arguments('<input-directory> <output-directory>')
  .description('Processes files in the input directory and outputs generated HTML in the output-directory')
  .option('--exclude <glob>', 'Exclude the matching patterns from processing')
  .option('--template-dor <dir>', 'Use this directory to try loading template to render the output')
  .parse(process.argv);



main({
  inputDir: program.args[0],
  outputDir: program.args[1],
  exclude: program.exclude,
  templateDir: program.templateDir
});
