import * as esbuild from "esbuild";
import path from "path";

const entryPoint = path.resolve("src/interfaces/web/dashboard/main.tsx");
const outfile = path.resolve("dist/dashboard.js");

async function build() {
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    minify: process.argv.includes("--minify"),
    sourcemap: process.argv.includes("--sourcemap"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  });
  console.log(`Built dashboard → ${outfile}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
