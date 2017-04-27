var _ = require('lodash'),
    Promise = require('promise'),
    glob = Promise.denodeify(require('glob')),
    elm = require('node-elm-compiler'),
    path = require('path'),
    marked = require('marked'),
    highlight = require('highlight.js'),
    webshot = Promise.denodeify(require('webshot')),
    sharp = require('sharp'),
    fs = (function(fs) {
      ['readFile', 'stat', 'writeFile'].forEach(function(fun) {
        fs[fun] = Promise.denodeify(fs[fun]);
      });
      return fs;
    })(require('fs'))
    ;

/**
 * Compiles an elm file to a target file location returning a promise when done.
 */
function compileElm(input, output) {
  return new Promise(function(resolve, reject) {
      elm.compile(input, {output: output}).on('close', function(exitCode) {
        if (exitCode !== 0) {
          reject(new Error('Compilation failed'));
        } else {
          resolve(output);
        }
      });
  });
}

module.exports = function(options) {
  _.defaults(options, {
    inputDir: process.cwd(),
    outputDir: process.cwd(),
    exclude: '/elm-stuff/**',
    templateDir: path.join(__dirname, 'templates'),
    delay: 0,
    width: 990,
    height: 504,
    templateData: {}
  });

  /**
   * Loads a named template and returns a function, that takes an output path and some
   * data and evaluates the template and writes the data.
   */
  function loadTemplate(name) {
    var templatePath;
    return fs.stat(path.join(options.templateDir, name))
    .then(function(stat) {
      if (stat.isFile()) {
        return path.join(options.templateDir, name);
      }
      return path.join(__dirname, 'templates', name);
    })
    .then(_.partial(fs.readFile, _, 'utf8'))
    .then(function(templateSrc) {
      var t = _.template(templateSrc, {imports: {_: _}});
      return function(output, data) {
        return fs.writeFile(path.join(options.outputDir, output), t(data)).then(function(out) {
          console.log('Succesfully generated ' + path.join(options.outputDir, output));
          return out;
        });
      }
    });
  }

  function filterFiles(files) {
    return Promise.all(files.map(function(file) {
      return fs.readFile(file, 'utf8').then(function(source) {
        if (!source.match(/module \w*( exposing \(.*main.*\))?\w*\n/i)) {
          return false;
        } else {
          return file;
        }
      });
    })).then(function(f) {
      return f;
    }).then(_.partial(_.filter, _, _.identity));
  }

  function compileAndRenderPreviews(files) {
    return Promise.all(files.map(function(file) {
      return Promise.resolve({filename: file, basename: path.basename(file, '.elm')})
      .then(function(f) {
        return compileElm(f.filename, path.join(options.outputDir, f.basename, 'iframe.html'))
          .then(function(output) {
            var bigPicture = path.join(options.outputDir, f.basename, 'preview@3x.png');
            return webshot(output, bigPicture, {
              siteType: 'file',
              windowSize: {
                width: options.width,
                height: options.height
              },
              defaultWhiteBackground: true,
              renderDelay: options.delay
            }).then(function() {
              console.log('Succesfully generated ' + bigPicture);
              var w = Math.floor(options.width / 3),
                  h = Math.floor(options.height / 3)
              var resizer = sharp(bigPicture);
              return resizer.clone().resize(w*2, h*2)
                .toFile(path.join(options.outputDir, f.basename, 'preview@2x.png'))
                .then(function() {
                  console.log('Succesfully generated ' + path.join(options.outputDir, f.basename, 'preview@2x.png'));
                  return resizer.clone().resize(w, h)
                    .toFile(path.join(options.outputDir, f.basename, 'preview.png'))
                    .then(function() {
                      console.log('Succesfully generated ' + path.join(options.outputDir, f.basename, 'preview.png'));
                    })
                });
            });
          });
      });
    }));
  }

  marked.setOptions({
    highlight: function (code) {
      return highlight.highlight('elm', code).value;
    }
  });


  function readElmPackageJSON(baseDir, currentDir) {
    if (typeof currentDir === "undefined") {
      baseDir = path.resolve(baseDir);
      currentDir = baseDir;
    }

    var parsedPath = path.parse(currentDir);
    if (parsedPath.root === parsedPath.dir) {
      return Promise.reject("elm-package.json not found");
    }

    var elmPackagePath = path.join(currentDir, 'elm-package.json');

    return fs.readFile(path.join(currentDir, 'elm-package.json'), 'utf8')
      .catch(function(err) {
        if (err.code === 'ENOENT') {
          return readElmPackageJSON(baseDir, path.dirname(currentDir));
        } else {
          throw err;
        }
      });
  }



  function processFile(f) {
    return fs.readFile(f, 'utf8').then(function(source) {
      var firstCommentRegexp = /\{\-\|((?:.|\n)*?)\s*\-\}\n+/m;
      var m = source.match(firstCommentRegexp);
      if (m) {
        var firstComment = marked(m[1]);
        source = source.replace(firstCommentRegexp, '\n');
      }
      var highlighted = highlight.highlight('elm', source).value;
      return {
        source: source,
        firstComment: firstComment,
        highlighted: highlighted,
        filename: f,
        basename: path.basename(f, '.elm')
      }
    });
  }

  function processDependencies(f) {
    return processFile(f).then(function(top) {
      return elm.findAllDependencies(f, [], options.inputDir).then(function(deps) {
        return deps.map(function(dep) {
          return processFile(path.join(options.inputDir, dep));
        });
      }).then(function(objs) {
        return {
          sources: [top].concat(objs),
          iframe: 'iframe.html',
          name: path.basename(f, '.elm'),
          path: f,
          style: {
            source: function(name) {
              return fs.readFileSync(require.resolve('highlight.js/styles/' + name + '.css'), 'utf8')
            },
            path: function(name) {
              return require.resolve('highlight.js/styles/' + name + '.css');
            }
          }
        }
      });
    });
  }

  function renderPages(elmFiles) {
    Promise.all([
      Promise.all(elmFiles.map(processDependencies)),
      loadTemplate('show.jst'),
      loadTemplate('index.jst'),
      readElmPackageJSON(options.inputDir).then(JSON.parse)
    ]).then(_.spread(function(elmData, showTemplate, indexTemplate, elmPackage) {
      return indexTemplate('index.html', {allExamples: elmData, width: options.width, height: options.height, package: elmPackage, custom: options.templateData})
      .then(function() {
        return Promise.all(elmData.map(function(ed) {
          return showTemplate(path.join(ed.name, 'index.html'), _.merge({
            allExamples: elmData, width: options.width, height: options.height, package: elmPackage, custom: options.templateData}, ed));
        }))
      });
    }));
  }

  return Promise.all([glob(options.inputDir + '/**/*.elm'), glob(options.inputDir + options.exclude)])
  .then(_.spread(_.difference))
  .then(filterFiles)
  .then(function(elmFilesWithMain) {
    return Promise.all([
      compileAndRenderPreviews(elmFilesWithMain),
      renderPages(elmFilesWithMain)
    ]);
  })
  .then(_.spread(function(previews, pages) {
    return true;
  }));
};
