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
    })(require('fs')),
    fileUrl = require('file-url'),
    StaticServer = require('static-server'),
    minify = require('html-minifier').minify,
    workboxBuild = require('workbox-build');
    ;

var exampleConfigRegexp = /\{\-(\s*{(?:.|\n)*?})\s*\-\}\n*/m;

/**
 * Compiles an elm file to a target file location returning a promise when done.
 */
function compileElm(input, output) {
  return new Promise(function(resolve, reject) {
      elm.compile(input, {output: output, optimize: true}).on('close', function(exitCode) {
        if (exitCode !== 0) {
          reject(new Error('Compilation failed'));
        } else {
          resolve(output);
        }
      });
  })
  .then(_.partial(fs.readFile, _, 'utf8'))
  .then(function(src) {
    return fs.writeFile(output, minify(src, {
      minifyJS: {
        mangle: true,
        compress: {
          pure_funcs: ["F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9"],
          pure_getters: true,
          keep_fargs: false,
          unsafe_comps: true,
          unsafe: true,
          passes:  2
        }
      }
    }))
  });
}

module.exports = function(options) {
  _.defaults(options, {
    inputDir: process.cwd(),
    outputDir: process.cwd(),
    exclude: '/elm-stuff/**',
    templateDir: path.join(__dirname, 'templates'),
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
      console.info("Could not find", name, "in", options.templateDir, "using default instead");
      return path.join(__dirname, 'templates', name);
    })
    .then(_.partial(fs.readFile, _, 'utf8'))
    .then(function(templateSrc) {
      var t = _.template(templateSrc, {imports: {_: _}});
      return function(output, data) {
        var result = minify(t(data), {
          collapseWhitespace: true,
          minifyCSS: true,
          minifyJS: true,
          sortAttributes: true,
          sortClassName: true
        });
        return fs.writeFile(path.join(options.outputDir, output), result).then(function(out) {
          console.log('Succesfully generated ' + path.join(options.outputDir, output));
          return out;
        });
      }
    });
  }

  function filterFiles(files) {
    return Promise.all(files.map(function (file) {
      return fs.readFile(file, 'utf8').then(function (source) {
        if (!source.match(/module \w* exposing \(.*main.*\)\w*/i)) {
          return false;
        } else {
          console.log("Found " + file);
          return file;
        }
      });
    })).then(function(f) {
      return f;
    }).then(_.partial(_.filter, _, _.identity));
      .then(function (f) {
        console.log("Found " + f.length + " Examples");
        return f;
      });
  }

  function parseExampleConfig(f) {
    return fs.readFile(f, 'utf8').then(function(source) {

      var m = source.match(exampleConfigRegexp);
      var defaults = {
        delay: 10,
        additionalShots: []
      };
      if (m) {
        return _.defaults(JSON.parse(m[1]), defaults);
      }
      return defaults;
    });
  }

  function snapPicture(dir, name, output, delay, additionalOptions) {
    var bigPicture = path.join(dir, name + '@3x.png');
    return webshot(output, bigPicture, _.merge({
      siteType: 'url',
      windowSize: {
        width: options.width,
        height: options.height
      },
      defaultWhiteBackground: true,
      renderDelay: delay
    }, additionalOptions.webshot)).then(function() {
      console.log('Succesfully generated ' + bigPicture);
      var w = Math.floor(options.width / 3),
          h = Math.floor(options.height / 3)
      var resizer = sharp(bigPicture);

      return Promise.all(_.flatMap([1, 2], function(factor) {
        var fName = path.join(dir, name + (factor > 1 ? '@' + factor + 'x.png' : '.png'));
        var resized = resizer.clone().resize(w * factor, h * factor)

         return [
          resized.clone().webp().toFile(path.join(dir, name + (factor > 1 ? '@' + factor + 'x.webp' : '.webp')))

          ,resized.toFile(fName)
          .then(function() {
            console.log('Succesfully generated ' + fName);
          })]
      }).concat(resizer.clone().webp().toFile(path.join(dir, name + '@3x.webp'))));
    });
  }

  function compileAndRenderPreviews(files) {
    var port = 4985;
    var server = new StaticServer({
      rootPath: options.outputDir,
      port: port
    });
    return new Promise(function(resolve, reject) {
      server.start(function() {
        return Promise.all(files.map(function(file) {
          return Promise.resolve({filename: file, basename: path.basename(file, '.elm')})
          .then(function(f) {
            return compileElm(f.filename, path.join(options.outputDir, f.basename, 'iframe.html'))
              .then(function(output) {
                return parseExampleConfig(f.filename).then(function(opts) {
                  var dir = path.join(options.outputDir, f.basename);
                  var snaps = ['preview'].concat(opts.additionalShots);
                  return Promise.all(snaps.map(function(snap) {
                    var url = 'http://localhost:' + port + "/" + path.join(f.basename, 'iframe.html');
                    var p = url + (snap === 'preview' ? '' : '#' + snap);
                    var additionalOptions = opts.options && opts.options[snap] || {}
                    return snapPicture(dir, snap, p, opts.delay, additionalOptions);
                  }));
                });
              });
          });
        })).then(function(stuff) {
          server.stop();
          resolve(stuff);
        }, reject);
      });
    });


  }

  marked.setOptions({
    highlight: function (code) {
      return highlight.highlight('elm', code).value;
    }
  });


  function readElmJSON(baseDir, currentDir) {
    if (typeof currentDir === "undefined") {
      baseDir = path.resolve(baseDir);
      currentDir = baseDir;
    }

    var parsedPath = path.parse(currentDir);
    if (parsedPath.root === parsedPath.dir) {
      return Promise.reject("elm.json not found");
    }

    var elmPackagePath = path.join(currentDir, 'elm.json');

    return fs.readFile(path.join(currentDir, 'elm.json'), 'utf8')
      .catch(function(err) {
        if (err.code === 'ENOENT') {
          return readElmJSON(baseDir, path.dirname(currentDir));
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
      source = source.replace(exampleConfigRegexp, '\n')
      var highlighted = highlight.highlight('elm', source, true).value;
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
          displayName: path.basename(f, '.elm').replace(/[a-z][A-Z]/g, function(s) {
            return s[0] + ' ' + s[1];
          }),
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
    return Promise.all([
      Promise.all(elmFiles.map(processDependencies)),
      loadTemplate('show.jst'),
      loadTemplate('index.jst'),
      readElmJSON(options.inputDir).then(JSON.parse)
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
    return workboxBuild.generateSW({
      swDest: path.join(options.outputDir, 'service-worker.js'),
      globDirectory: options.outputDir,
      globPatterns: ["**/*.{html,css}", "**/preview.png"]
    })

  }));
};
