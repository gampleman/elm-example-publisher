import { promises as fs } from "node:fs";
import path from "node:path";
import * as log from "./log.js";
import type { Example, EllieConfig } from "./types.js";

type Ellie = {
  title: string;
  elmCode: string;
  htmlCode: string;
  dependencies: Record<string, string>;
};

const authenticate = async (): Promise<string> => {
  const request = await fetch("https://ellie-app.com/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `mutation {
            authenticate: authenticate
          }`,
    }),
  });
  const response = (await request.json()) as {
    data: { authenticate: string };
  };
  return response.data.authenticate;
};

const saveEllie = async (token: string, ellie: Ellie): Promise<string> => {
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
                }`,
                  )
                  .join(",\n")}
            ]
        }) { id }
    }`,
    }),
  });
  const response = (await request.json()) as {
    data: { revision: { id: string } };
  };
  return `https://ellie-app.com/${response.data.revision.id}`;
};

export default async (
  examples: Example[],
  inputDir: string,
  opts: EllieConfig,
): Promise<Example[]> => {
  log.heading("Publishing Ellies");
  const token = await authenticate();
  log.generated("Authenticated with Ellie API");

  const elmJson = JSON.parse(
    await fs.readFile(path.join(inputDir, "elm.json"), "utf8"),
  ) as { dependencies: { direct: Record<string, string> } };

  return Promise.all(
    examples.map(async (example): Promise<Example> => {
      let source = example.source;
      const requires = example.tags.requires;
      if (requires) {
        if (opts.baseUrl) {
          (Array.isArray(requires) ? requires : [requires]).forEach((req) => {
            source = source.replace(
              `"${req}"`,
              `"${opts.baseUrl}/${example.basename}/${req}"`,
            );
          });
        } else {
          console.error(
            `Couldn't upload Ellie for ${example.basename}, since it uses a @requires tag, but no --base-url was specified. This would cause the example not to function properly, so we are skipping uploading this example.`,
          );
          return example;
        }
      }

      const ellie: Ellie = {
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
      return { ...example, ellieLink };
    }),
  );
};
