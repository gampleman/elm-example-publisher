const fetch = require("node-fetch"),
  gather = require("./gather"),
  fs = require("fs").promises,
  path = require("path"),
  log = require("./log");

const authenticate = async () => {
  const request = await fetch("https://ellie-app.com/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation { 
            authenticate: authenticate 
          }`,
    }),
  });
  const response = await request.json();
  return response.data.authenticate;
};

const saveEllie = async (token, ellie) => {
  const request = await fetch("https://ellie-app.com/api", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `mutation {
        revision: createRevision(inputs: {
            elmCode: ${JSON.stringify(ellie.elmCode)},
            htmlCode: ${JSON.stringify(ellie.htmlCode)},
            title: ${JSON.stringify(ellie.title)},
            termsVersion: 4,
            packages: [
                ${Object.entries(ellie.dependencies)
                  .map(
                    ([name, version]) => `{
                    name: "${name}",
                    version: "${version}"
                }`
                  )
                  .join(",\n")}
            ]
        }) { id }
    }`,
    }),
  });
  const response = await request.json();
  return `https://ellie-app.com/${response.data.revision.id}`;
};

module.exports = async (examples, inputDir, opts) => {
  log.heading("Publishing Ellies");
  const token = await authenticate();
  log.generated("Authenticated with Ellie API");

  const elmJson = await fs
    .readFile(inputDir.join("elm.json").absolute)
    .then(JSON.parse);

  const newExamples = await Promise.all(
    examples.map(async (example) => {
      let source = example.source;
      if (example.tags.requires) {
        if (opts.baseUrl) {
          (Array.isArray(example.tags.requires)
            ? example.tags.requires
            : [example.tags.requires]
          ).forEach((req) => {
            source = source.replace(
              `"${req}"`,
              `"${opts.baseUrl}/${example.basename}/${req}"`
            );
          });
        } else {
          console.error(
            `Couldn't upload Ellie for ${example.basename}, since it uses a @requires tag, but no --base-url was specified. This would cause the example not to function properly, so we are skipping uploading this example.`
          );
          return example;
        }
      }

      const ellie = {
        title: example.basename,
        elmCode: source,
        htmlCode: `<html>
          <head>
            <style>
              /* you can style your program here */
            </style>
          </head>
          <body>
            <main></main>
            <script>
              var app = Elm.${example.basename}.init({ node: document.querySelector('main') })
              // you can use ports and stuff here
            </script>
          </body>
          </html>      
          `,
        dependencies: {
          ...elmJson.dependencies.direct,
          ...opts.additionalDependencies,
        },
      };

      const ellieLink = await saveEllie(token, ellie);
      log.generated(`${example.basename}: ${ellieLink}`);
      return { ...example, tags: { ...example.tags, ellieLink } };
    })
  );
  return newExamples;
};
