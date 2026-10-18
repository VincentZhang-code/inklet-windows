import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const engine = mathjax.document('', {
  InputJax: new TeX({ packages: AllPackages.filter(name => !['require', 'autoload', 'html'].includes(name)), maxBuffer: 20000, maxMacros: 1000 }),
  OutputJax: new SVG({ fontCache: 'none' }),
});
self.onmessage = event => {
  const { id, tex, display } = event.data;
  try {
    if (tex.length > 20000) throw new Error('公式过长');
    const result = engine.convert(tex, { display, em: 16, ex: 8, containerWidth: 720 });
    self.postMessage({ id, svg: adaptor.outerHTML(result) });
    engine.clear();
  } catch (error) { self.postMessage({ id, error: error.message }); }
};