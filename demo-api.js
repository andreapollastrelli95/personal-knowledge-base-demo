/*
 * Modalità demo: sostituisce il server dell'app (/api/data e /api/gemini) con un archivio nel browser.
 * I dati restano solo in questo browser (localStorage); l'assistente AI non è attivo nella demo.
 * Stessa logica di versione del server reale, così sincronizzazione e conflitti si comportano allo stesso modo.
 */
(function () {
  var script = document.currentScript;
  var MODE = script.getAttribute('data-mode');
  var KEY = 'demo-api-' + MODE;
  var realFetch = window.fetch.bind(window);

  function load() {
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch (e) { }
    return MODE === 'pcc' ? { rev: 0, data: null } : { version: 0, data: null };
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { } }
  function reply(status, body) {
    return Promise.resolve(new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } }));
  }

  function data(method, body) {
    var cur = load();
    if (method === 'GET') return reply(200, cur);
    if (method !== 'PUT') return reply(405, { error: 'metodo non consentito' });
    body = body || {};
    if (MODE === 'pcc') {
      if (body.baseRev !== cur.rev) return reply(409, cur);
      var nr = (cur.rev || 0) + 1;
      save({ rev: nr, data: body.data });
      return reply(200, { rev: nr });
    }
    var v = cur.version || 0, base = body.baseVersion, conflict;
    if (MODE === 'pkb') conflict = cur.data && Number(base) !== v;
    else if (MODE === 'la') conflict = (base || 0) !== v;
    else conflict = base !== v;
    if (conflict) return reply(409, MODE === 'aih' ? cur : { version: v });
    var nv = MODE === 'pkb' ? Math.max(Date.now(), v + 1) : MODE === 'la' ? Date.now() : v + 1;
    save({ version: nv, data: body.data });
    return reply(200, { version: nv });
  }

  var AI_OFF = 'Assistente AI non disponibile nella demo: nella versione completa le risposte arrivano da Google Gemini.';

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var m = url.match(/\/api\/(data|gemini)\b/);
    if (!m) return realFetch(input, init);
    init = init || {};
    var method = (init.method || 'GET').toUpperCase(), body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { }
    if (m[1] === 'data') return data(method, body);
    return reply(200, { ok: false, error: AI_OFF });
  };

  // Etichetta fissa: chi apre la demo sa che i dati sono fittizi.
  document.addEventListener('DOMContentLoaded', function () {
    var tag = document.createElement('div');
    tag.textContent = 'DEMO · dati fittizi';
    tag.setAttribute('role', 'status');
    tag.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:99999;padding:4px 10px;border-radius:999px;' +
      'background:#b45309;color:#fff;font:600 12px system-ui,sans-serif;letter-spacing:.03em;pointer-events:none;opacity:.92';
    document.body.appendChild(tag);
  });
})();
