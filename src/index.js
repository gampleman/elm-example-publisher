import processOptions from "./options.js";
import { build, watch } from "./borek-based/index.js";
import { startDevServer } from "./devServer.js";

export default async (rawOptions) => {
  const options = processOptions(rawOptions);

  if (options.watch) {
    await startDevServer(options, watch);
  } else {
    await build(options);
  }
};
