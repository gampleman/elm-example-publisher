// Ambient declarations for dependencies that ship no usable types.

// sharp ships types at lib/index.d.ts, but its package.json "exports" map
// doesn't expose them under NodeNext resolution. Re-export the real types from
// that path so `import sharp from "sharp"` is correctly typed (and callable).
declare module "sharp" {
  import sharp from "sharp/lib/index.js";
  export = sharp;
}

// node-elm-compiler ships no type declarations; we only use these two helpers.
declare module "node-elm-compiler" {
  export function compileToString(
    sources: string[],
    options?: {
      output?: string;
      optimize?: boolean;
      cwd?: string;
      [key: string]: unknown;
    },
  ): Promise<string>;
  export function findAllDependencies(file: string): Promise<string[]>;
  const _default: {
    compileToString: typeof compileToString;
    findAllDependencies: typeof findAllDependencies;
  };
  export default _default;
}
