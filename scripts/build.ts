// Build script for dsh-usage-dock.
//
// 1. Server: transpile src/server.ts -> lib/index.js (ESM, Node 20). Runtime
//    entry stays lib/index.js (package.json `main`), so DSH keeps loading the
//    same path as before the TypeScript migration.
// 2. Client: bundle src/client.tsx with esbuild (CJS, browser) into
//    dist/client.core.js, then wrap it into lib/client.js + dist/client.js —
//    a __ModuleLoader__.load({ id, factory }) wrapper; shared deps (react,
//    @deepseek-ai/*) resolve through the loader's require.
//
// Usage: tsx scripts/build.ts [--client-only]

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const clientOnly = process.argv.includes("--client-only");

mkdirSync(join(root, "dist"), { recursive: true });
mkdirSync(join(root, "lib"), { recursive: true });

if (!clientOnly) {
  await build({
    entryPoints: [join(root, "src", "server.ts")],
    outfile: join(root, "lib", "index.js"),
    format: "esm",
    platform: "node",
    target: "node20",
    packages: "external",
    sourcemap: false,
    logLevel: "warning",
  });
  console.log("built lib/index.js from src/server.ts");
}

await build({
  entryPoints: [join(root, "src", "client.tsx")],
  bundle: true,
  format: "cjs",
  platform: "browser",
  outfile: join(root, "dist", "client.core.js"),
  external: ["react", "react/jsx-runtime", "react-dom", "@deepseek-ai/*"],
  jsx: "automatic",
  logLevel: "warning",
});

const core = readFileSync(join(root, "dist", "client.core.js"), "utf8");
const wrapper = `window.__ModuleLoader__.load({
	id: "dsh-usage-dock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
${core}
		return module.exports;
	}
});
`;
writeFileSync(join(root, "lib", "client.js"), wrapper);
writeFileSync(join(root, "dist", "client.js"), wrapper);
console.log("built lib/client.js + dist/client.js (" + wrapper.length + " bytes)");
