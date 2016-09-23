var _ = require('lodash'),
    glob = require('glob').sync,
    elm = require('node-elm-compiler'),
    path = require('path'),
    fs = require('fs'),
    marked = require('marked'),
    highlight = require('highlight.js'),
    Promise = require('promise'),
    webshot = require('webshot'),
    sharp = require('sharp')
    ;

module.exports = function(options) {
  _.defaults(options, {
    inputDir: process.cwd(),
    outputDir: process.cwd(),
    exclude: '/elm-stuff/**',
    templateDir: path.join(__dirname, 'templates')
  });

  function loadTemplate(name) {
    var templatePath;
    if (fs.statSync(path.join(options.templateDir, name)).isFile()) {
      templatePath = path.join(options.templateDir, name);
    } else {
      templatePath = path.join(__dirname, 'templates', name);
    }
    var t = _.template(fs.readFileSync(templatePath, 'utf8'), {imports: {_: _}, sourceUrl: 'file://' + templatePath});
    return function(output, data) {
      fs.writeFileSync(path.join(options.outputDir, output), t(data));
    }
  }

  var elmFiles = _.difference(glob(options.inputDir + '/**/*.elm'), glob(options.inputDir + options.exclude));
  var results = elmFiles.map(function(f) {
    elm.compile(f, {output: path.join(options.outputDir,  path.basename(f, '.elm'), 'iframe.html')})

    webshot(path.join(options.outputDir,  path.basename(f, '.elm'), 'iframe.html'), path.join(options.outputDir,  path.basename(f, '.elm'), 'preview@3x.png'), {
      siteType: 'file',
      windowSize: {
        width: 990,
        height: 504
      },
      defaultWhiteBackground: true
    }, function() {
      var resizer = sharp(path.join(options.outputDir,  path.basename(f, '.elm'), 'preview@3x.png'));
      resizer.clone().resize(330*2, 168*2).toFile(path.join(options.outputDir,  path.basename(f, '.elm'), 'preview@2x.png'))
      resizer.clone().resize(330, 168).toFile(path.join(options.outputDir,  path.basename(f, '.elm'), 'preview.png'))
    });
    return path.join(path.basename(f, '.elm'), 'iframe.html');
  });
  var iframes = _.zipObject(elmFiles, results);
  marked.setOptions({
    highlight: function (code) {x
      return highlight.highlight('elm', code).value;
    }
  });
  function processFile(f) {
    var source = fs.readFileSync(f, 'utf8');
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
  }
  Promise.all(elmFiles.map(function(f) {
    var top = processFile(f);
    return elm.findAllDependencies(f).then(function(deps) {
      return deps.map(function(dep) {
        return processFile(dep);
      })
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
  })).then(function(elmData) {
    var showTemplate = loadTemplate('show.jst'),
        indexTemplate = loadTemplate('index.jst');

    indexTemplate('index.html', {allExamples: elmData});
    elmData.forEach(function(ed) {
      showTemplate(path.join(ed.name, 'index.html'), _.merge({allExamples: elmData}, ed));
    });
    console.log('DONE');
  }, function(e) {
    console.error(e);
  });
};
