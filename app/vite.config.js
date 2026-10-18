import { defineConfig } from 'vite';
import valueParser from 'postcss-value-parser';

export const modernFontSources = {
  postcssPlugin: 'inklet-modern-font-sources',
  Declaration: {
    src(declaration) {
      if (declaration.parent?.name !== 'font-face') return;
      const file = declaration.source?.input?.file?.replaceAll('\\', '/') || '';
      if (!file.includes('/@fontsource/manrope/') && !file.includes('/@fontsource/literata/')) return;
      const groups = [[]];
      for (const node of valueParser(declaration.value).nodes) {
        if (node.type === 'div' && node.value === ',') groups.push([]);
        else groups[groups.length - 1].push(node);
      }
      const woff2 = groups.filter(group => group.some(node => node.type === 'function' && node.value === 'format' && node.nodes.some(part => part.value === 'woff2')));
      if (woff2.length) declaration.value = woff2.map(group => valueParser.stringify(group).trim()).join(', ');
    },
  },
};

export default defineConfig(() => ({
  base: './',
  define: { PACKAGE_VERSION: JSON.stringify('3.2.1') },
  server: { host: '127.0.0.1', port: 5186, strictPort: false },
  optimizeDeps: { include: [
    'docx',
    'mathjax-full/js/mathjax.js', 'mathjax-full/js/input/tex.js', 'mathjax-full/js/output/svg.js',
    'mathjax-full/js/adaptors/liteAdaptor.js', 'mathjax-full/js/handlers/html.js', 'mathjax-full/js/input/tex/AllPackages.js',
  ] },
  worker: { format: 'es' },
  css: { postcss: { plugins: [modernFontSources] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2500 },
}));