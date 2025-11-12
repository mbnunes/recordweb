// record_capture_recaptcha.js
// Node (CommonJS). Requisitos: npm install playwright rrweb
// Uso: node record_capture_recaptcha.js
// Abre a página, injeta snippet para capturar g-recaptcha-response, grava com rrweb
// e para somente quando você apertar ENTER no terminal.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

(async () => {
  const OUT_DIR = path.resolve(__dirname, 'recordings');
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const OUT_JSON = path.join(OUT_DIR, 'rrweb_record.json');
  const OUT_GZ = path.join(OUT_DIR, 'rrweb_record.json.gz');

  const TARGET_URL = 'SUA_URL';
  const HEADLESS = false; // visível para você interagir

  let browser;
  try {
    browser = await chromium.launch({ headless: HEADLESS });
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();

    // LOGS da página relevantes (mirror notificações)
    page.on('console', msg => {
      try {
        const text = msg.text();
        if (text.includes('[rrweb-mirror]')) {
          console.log('PAGE_LOG:', text);
        } else {
          // descomente caso queira ver tudo
          // console.log('PAGE:', text);
        }
      } catch (e) {}
    });

    // Interceptar requests para procurar g-recaptcha-response / tokens longos
    page.on('request', req => {
      try {
        if (req.method() === 'POST' || req.method() === 'PUT') {
          const pd = req.postData();
          if (pd) {
            if (pd.includes('g-recaptcha-response')) {
              console.log('[NETWORK] request contains g-recaptcha-response ->', req.url());
              console.log('  excerpt:', pd.slice(0, 300));
            } else {
              const m = pd.match(/[A-Za-z0-9_-]{40,}/);
              if (m) {
                console.log('[NETWORK] request possibly contains token (excerpt):', m[0].slice(0, 120), '->', req.url());
              }
            }
          }
        }
      } catch (e) {}
    });

    page.on('response', async res => {
      try {
        const ct = (res.headers()['content-type'] || '').toLowerCase();
        if (ct.includes('json') || ct.includes('text')) {
          const url = res.url();
          // limitar análise para urls prováveis (opcional)
          if (url.includes('habilitacao') || url.includes('consulta') || url.includes('integracao') || url.includes('recaptcha') || url.includes('google')) {
            const txt = await res.text().catch(() => null);
            if (txt) {
              if (txt.includes('g-recaptcha-response')) {
                console.log('[NETWORK] response contains g-recaptcha-response ->', url);
              } else {
                const m = txt.match(/[A-Za-z0-9_-]{40,}/);
                if (m) console.log('[NETWORK] response possibly contains token ->', url, 'excerpt:', m[0].slice(0, 120));
              }
            }
          }
        }
      } catch (e) {}
    });

    // Navega primeiro (DOMContentLoaded)
    console.log('Abrindo página:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Injeta rrweb lendo a lib localmente (evita CSP)
    let rrwebMin;
    try {
      const rrwebPath = require.resolve('rrweb/dist/rrweb.min.js');
      rrwebMin = fs.readFileSync(rrwebPath, 'utf8');
    } catch (e) {
      console.error('rrweb não encontrado em node_modules. Rode: npm install rrweb');
      throw e;
    }
    await page.addScriptTag({ content: rrwebMin });
    console.log('rrweb injetado com sucesso.');

    // Injeta snippet robusto para capturar o token (mirror + postMessage + wrap grecaptcha + polling + iframe scan)
    const mirrorSnippet = `
(function(){
  // cria mirror se não existir
  if (!document.getElementById('__rr_recaptcha_mirror')) {
    var m = document.createElement('div');
    m.id = '__rr_recaptcha_mirror';
    m.style.display = 'none';
    m.setAttribute('data-rr-captured', 'true');
    document.documentElement.prepend(m);
  }
  function setMirror(val, src) {
    try {
      var mm = document.getElementById('__rr_recaptcha_mirror');
      if (!mm) return;
      var prev = mm.textContent || '';
      if ((val||'') !== prev) {
        mm.textContent = val || '';
        mm.dispatchEvent(new CustomEvent('rr-recaptcha-changed', { detail: { value: val, src: src || 'unknown' } }));
        console.log('[rrweb-mirror] token detected src=' + (src||'unknown') + ' len=' + ((val||'').length));
      }
    } catch(e) {}
  }

  // DOM observer
  function checkDOMForToken() {
    try {
      var ta = document.querySelector('textarea[name="g-recaptcha-response"], input[name="g-recaptcha-response"]');
      if (ta) { setMirror(ta.value || ta.textContent || '', 'dom'); return true; }
    } catch(e){}
    return false;
  }
  var domObserver = new MutationObserver(function(){ checkDOMForToken(); });
  domObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  // poll
  var pollInterval = setInterval(function(){ checkDOMForToken(); }, 400);

  // postMessage listener
  function onMsg(ev) {
    try {
      var d = ev.data;
      if (!d) return;
      if (typeof d === 'object') {
        for (var k in d) {
          if (!Object.prototype.hasOwnProperty.call(d,k)) continue;
          var v = String(d[k] || '');
          if (!v) continue;
          if (k.toLowerCase().indexOf('recaptcha') >= 0 || k.toLowerCase().indexOf('g-recaptcha') >= 0 || (v.length>50 && /[A-Za-z0-9_-]+/.test(v))) {
            setMirror(v, 'postMessage');
            return;
          }
        }
      } else if (typeof d === 'string') {
        if (d.indexOf('g-recaptcha-response') >= 0 || d.length > 50) setMirror(d, 'postMessageStr');
      }
    } catch(e){}
  }
  window.addEventListener('message', onMsg, false);

  // scan same-origin iframes and observe them
  function scanIframes() {
    try {
      var ifr = Array.prototype.slice.call(document.querySelectorAll('iframe'));
      for (var i=0;i<ifr.length;i++) {
        try {
          var f = ifr[i];
          var doc = f.contentDocument;
          if (!doc) continue;
          var ta = doc.querySelector('textarea[name=\"g-recaptcha-response\"], input[name=\"g-recaptcha-response\"]');
          if (ta) {
            setMirror(ta.value || ta.textContent || '', 'iframe-sameorigin');
            // observe
            (function(el){
              var obs2 = new MutationObserver(function(){ setMirror(el.value || el.textContent || '', 'iframe-sameorigin'); });
              obs2.observe(doc, { childList:true, subtree:true, attributes:true, characterData:true });
            })(ta);
          }
        } catch(e){}
      }
    } catch(e){}
  }
  scanIframes();
  var iframeObserver = new MutationObserver(function(){ scanIframes(); });
  iframeObserver.observe(document.documentElement, { childList:true, subtree:true });

  // wrap grecaptcha if available (or poll until available)
  function wrapGre() {
    try {
      if (!window.grecaptcha) return false;
      var g = window.grecaptcha;
      if (g.execute && !g.__rr_wrapped_execute) {
        var origExec = g.execute.bind(g);
        g.execute = function() {
          var res = origExec.apply(this, arguments);
          try {
            if (res && typeof res.then === 'function') {
              res.then(function(tok){ setMirror(tok, 'grecaptcha.execute.promise'); }).catch(()=>{});
            }
          } catch(e){}
          return res;
        };
        g.__rr_wrapped_execute = true;
      }
      if (g.render && !g.__rr_wrapped_render) {
        var origRender = g.render.bind(g);
        g.render = function(container, params) {
          try {
            if (params && typeof params.callback === 'function') {
              var origCb = params.callback;
              params.callback = function(token) {
                try { setMirror(token, 'grecaptcha.callback'); } catch(e){}
                return origCb.apply(this, arguments);
              };
            }
          } catch(e){}
          return origRender(container, params);
        };
        g.__rr_wrapped_render = true;
      }
      return true;
    } catch(e){ return false; }
  }
  wrapGre();
  var grePoll = setInterval(function(){
    try {
      var ok = wrapGre();
      if (ok) { clearInterval(grePoll); console.log('[rrweb-mirror] grecaptcha wrapped'); }
    } catch(e){}
  }, 500);

  // expose stop
  window.__rr_recaptcha_mirror_stop = function() {
    try { domObserver.disconnect(); } catch(e){}
    try { iframeObserver.disconnect(); } catch(e){}
    try { window.removeEventListener('message', onMsg, false); } catch(e){}
    try { clearInterval(pollInterval); } catch(e){}
    try { clearInterval(grePoll); } catch(e){}
  };
})();
`;

    await page.addInitScript({ content: mirrorSnippet }); // ensure it's present early
    // also inject immediately to current doc (some pages create elements earlier)
    await page.evaluate(mirrorSnippet);

    // Expose binding for rrweb events
    const events = [];
    await page.exposeBinding('rrwebEvent', (source, event) => {
      try { events.push(event); } catch (e) {}
    });

    // Start rrweb.record (recording)
    await page.evaluate(() => {
      if (!window.rrweb || typeof rrweb.record !== 'function') {
        console.error('rrweb not available in page context');
        return;
      }
      window.__rrweb_stop = rrweb.record({
        emit(event) {
          try { window.rrwebEvent(event); } catch (e) { (window.__rrweb_buffer__ = window.__rrweb_buffer__ || []).push(event); }
        },
        recordCanvas: true,
        checkoutEveryNth: 300
      });
      window.__rrweb_get_buffer = function(){ return window.__rrweb_buffer__ || []; };
    });

    console.log('rrweb recording started. Preencha o formulário normalmente (captcha hidden pode executar).');
    console.log('A gravação só será parada quando você pressionar ENTER neste terminal.');

    // checkpoint saver every N events (in background)
    const CHECKPOINT_EVERY = 300;
    const checkpointTimer = setInterval(() => {
      try {
        if (events.length >= CHECKPOINT_EVERY) {
          // write partial (overwrite)
          fs.writeFileSync(OUT_JSON, JSON.stringify(events));
          console.log(`Checkpoint salvo — eventos capturados: ${events.length} (arquivo: ${OUT_JSON})`);
        }
      } catch (e) {
        console.warn('Erro ao salvar checkpoint:', e.message || e);
      }
    }, 5000);

    // Wait for ENTER
    console.log('\n--> Quando quiser parar e salvar, pressione ENTER no terminal.\n');
    await new Promise(resolve => {
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.pause();
        resolve();
      });
    });

    // stop checkpoint interval
    clearInterval(checkpointTimer);

    console.log('ENTER detectado — parando gravação...');

    // attempt to stop rrweb and recover any buffer
    try {
      await page.evaluate(() => { try { if (window.__rrweb_stop) window.__rrweb_stop(); } catch(e){} });
    } catch (e) {}

    // try to fetch local buffer appended in page
    try {
      const localBuffer = await page.evaluate(() => {
        try { return window.__rrweb_get_buffer ? window.__rrweb_get_buffer() : []; } catch(e) { return []; }
      });
      if (Array.isArray(localBuffer) && localBuffer.length) {
        // prepend so earlier events remain in order (if any)
        for (let i = localBuffer.length - 1; i >= 0; --i) {
          events.unshift(localBuffer[i]);
        }
        console.log('Recuperado buffer local do contexto da página (eventos):', localBuffer.length);
      }
    } catch (e) {
      console.warn('Não foi possível recuperar buffer local:', e.message || e);
    }

    console.log('Total eventos coletados:', events.length);

    // Save final files
    try {
      fs.writeFileSync(OUT_JSON, JSON.stringify(events));
      fs.writeFileSync(OUT_GZ, zlib.gzipSync(Buffer.from(JSON.stringify(events)), { level: 9 }));
      console.log('Gravação salva em:', OUT_JSON);
      console.log('Versão gzip salva em:', OUT_GZ);
    } catch (e) {
      console.error('Erro ao salvar gravação:', e.message || e);
    }

    // Stop mirror on page
    try { await page.evaluate(() => { try { window.__rr_recaptcha_mirror_stop && window.__rr_recaptcha_mirror_stop(); } catch(e){} }); } catch(e){}

    // close browser
    await browser.close();
    console.log('Navegador fechado. Pronto.');
  } catch (err) {
    console.error('Erro fatal:', err);
    try { if (browser) await browser.close(); } catch (e) {}
    process.exit(1);
  }
})();
