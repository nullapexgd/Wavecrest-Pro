import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';

// Vite bundles this file into a temp folder, so resolve siblings from its real location.
const here = fileURLToPath(new URL('.', import.meta.url));
const PAGES = ['pricing', 'privacy', 'terms', 'changelog', 'app', 'login', 'sample'];

// Shared partials (head, nav, footer) for every page, and the first picture baked into the
// home page: the HTML already holds one real creator's chart, so something complete shows
// before any script runs. The same code draws it in the browser for the random pick.
function site(): Plugin {
  let server: ViteDevServer | undefined;
  const partial = (name: string) => readFileSync(join(here, 'partials', `${name}.html`), 'utf8');
  const load = async (rel: string) =>
    server
      ? server.ssrLoadModule(`/src/data/${rel}`)
      : import(/* @vite-ignore */ pathToFileURL(join(here, 'src/data', rel)).href);
  return {
    name: 'wavecrest-site',
    configureServer(s) {
      server = s;
      // pretty URLs in dev, as vercel.json cleanUrls does in production
      s.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (PAGES.includes(path)) req.url = `/${path}.html`;
        next();
      });
    },
    configurePreviewServer(s) {
      s.middlewares.use((req, _res, next) => {
        const path = (req.url ?? '').split('?')[0]!.replace(/^\//, '');
        if (PAGES.includes(path)) req.url = `/${path}.html`;
        next();
      });
    },
    async transformIndexHtml(html, ctx) {
      const page = (ctx.filename.split('/').pop() ?? '').replace('.html', '');
      let out = html
        .replace('<!--HEAD-->', partial('head'))
        .replace('<!--NAV-->', partial('nav').replace(new RegExp(`(href="/${page}")`), '$1 aria-current="page"'))
        .replace('<!--FOOT-->', partial('foot'))
        .replace('<!--SHELL-->', partial('shell'));
      if (!out.includes('<!--RIDGE-->')) return out;

      const [model, posters, copy] = await Promise.all([load('model.ts'), load('posters.ts'), load('copy.ts')]);
      const data = JSON.parse(readFileSync(join(here, 'src/data/creators.json'), 'utf8'));
      const first = data.creators[0];
      const m = model.buildModel(first, first.videos, 'feed', data.snapshot);
      out = out
        .replace('<!--RIDGE-->', posters.ridgeSvg(m))
        .replace('<!--SCATTER-->', copy.scatterPair(posters.scatterSvg(m, 'wide'), posters.scatterSvg(m, 'tall')))
        .replace('<!--CAPTION-->', copy.captionText(m))
        .replace('<!--FACTS-->', copy.factsText(m))
        .replace('<!--LEGEND-CREST-->', copy.crestLegend(m))
        .replace('<!--CRESTS-->', copy.crestListHtml(m));
      return out;
    }
  };
}

// publicDir is `static/`, NOT the default `public/`: the repo root has an untracked
// legacy `public/` (the dead Express app) that must never be copied into a build.
export default defineConfig(({ mode }) => {
  const inline = mode === 'artifact';
  return {
    plugins: [site()],
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
        // the single-file preview is the home page only
        input: inline
          ? { main: join(here, `${process.env.ARTIFACT_PAGE ?? 'index'}.html`) }
          : { main: join(here, 'index.html'), ...Object.fromEntries(PAGES.map(p => [p, join(here, `${p}.html`)])) },
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
