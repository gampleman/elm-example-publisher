// Tags parsed from an example's module doc comment (e.g. @delay, @screenshot,
// @requires, @minify, @width, @height). Values are strings, or arrays of
// strings when a tag is repeated.
export type Tags = Record<string, string | string[]>;

// A gathered example program.
export type Example = {
  filename: string;
  source: string;
  description: string;
  tags: Tags;
  basename: string;
  width: number;
  height: number;
  ellieLink?: string;
};

// Resolved build options (produced by options.ts, consumed as Borek Input).
export type Options = {
  inputDir: string;
  outputDir: string;
  width: number;
  height: number;
  templateFile: string;
  assetDir: string;
  debug: boolean;
  ellie: EllieConfig | false;
  screenshots: boolean;
  watch: boolean;
  port: number;
};

export type EllieConfig = {
  baseUrl: string | null;
  additionalDependencies: Record<string, string>;
};
