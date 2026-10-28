import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Vite bundles this file into a temp folder, so resolve siblings from its real location.
const here = fileURLToPath(new URL('.', import.meta.url));

// Inlines the static fallbacks (generated from the same sample data as the 3D scene) into
// index.html, so the first response already contains a complete picture: no script needed.
function posters(): Plugin {
  return {
    name: 'wavecrest-posters',
    async transformIndexHtml(html) {
      // Cache-bust so editing the sample data or generator is picked up by the dev server.
      const url = pathToFileURL(join(here, 'tools/posters.mjs')).href;
      const mod = await import(/* @vite-ignore */ `${url}?t=${Date.now()}`);
      return html.replace('<!--RIDGE-->', mod.ridgeSvg()).replace('<!--SCATTER-->', mod.scatterSvg());
    }
  };
}

// publicDir is `static/`, NOT the default `public/`: the repo root has an untracked
// legacy `public/` (the dead Express app) that must never be copied into a build.
export default defineConfig(({ mode }) => {
  const inline = mode === 'artifact';
  return {
  plugins: [posters()],
  define: { __INLINE_MODELS__: JSON.stringify(inline) },
  publicDir: inline ? false : 'static',
  assetsInclude: ['**/*.glb'], // so `?inline` can embed the Blender models in the single-file build
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    outDir: inline ? 'dist-single' : 'dist',
    assetsInlineLimit: inline ? 100_000_000 : 4096,
    rollupOptions: {
      output: inline
        ? { inlineDynamicImports: true }
        : {
            // The 3D scene is its own chunk and is only fetched when the page decides to run it.
            manualChunks(id) {
              if (id.includes('node_modules/three')) return 'three';
            }
          }
    }
  }
  };
});
