import esbuild from "esbuild";
const prod = process.argv[2] === "production";
// 1) Obsidian plugin bundle (CJS, externals per Obsidian guidelines)
await esbuild.build({
  entryPoints: ["src/main.ts"], bundle: true, outfile: "main.js", format: "cjs", target: "es2020",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"], sourcemap: prod ? false : "inline", minify: prod, logLevel: "info",
});
// 2) core as ESM for the server renderer
await esbuild.build({ entryPoints: ["src/core.ts"], bundle: true, outfile: "dist/core.js", format: "esm", target: "es2020", logLevel: "info" });
