/* Carte domande CdG - interfaccia. La logica sta in core.js (CarteCore). */
(function () {
  'use strict';

  var C = window.CarteCore;
  var APP_VERSION = C.VERSION;
  var KEY_SESSION = 'carte-cdg-sessione';
  var KEY_IMPORT = 'carte-cdg-import';
  var KEY_META = 'carte-cdg-elenco';
  var CSV_URL = 'domande.csv';

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- memoria locale (con ripiego in memoria) ---------- */

  var store = (function () {
    var ok = false;
    var mem = {};
    try {
      var k = '__prova__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      ok = true;
    } catch (e) { ok = false; }
    return {
      available: ok,
      get: function (key) {
        if (!ok) return mem[key] == null ? null : mem[key];
        try { return window.localStorage.getItem(key); } catch (e) { return mem[key] == null ? null : mem[key]; }
      },
      set: function (key, val) {
        mem[key] = val;
        if (!ok) return;
        try { window.localStorage.setItem(key, val); } catch (e) { /* memoria piena: resta in RAM */ }
      },
      remove: function (key) {
        delete mem[key];
        if (!ok) return;
        try { window.localStorage.removeItem(key); } catch (e) { /* ignora */ }
      }
    };
  })();

  function readJSON(key) {
    try { return JSON.parse(store.get(key) || 'null'); } catch (e) { return null; }
  }

  /* ---------- stato ---------- */

  var parsed = null;      // elenco domande in uso
  var source = 'file';    // 'file' | 'import'
  var listMeta = null;    // { hash, date, firstSeen }
  var session = C.createSession();
  var updateAvailable = false;

  function saveSession() { store.set(KEY_SESSION, JSON.stringify(session)); }

  function loadSession() {
    session = C.restoreSession(readJSON(KEY_SESSION));
  }

  /* ---------- caricamento domande ---------- */

  function fetchCsv(fresh) {
    var url = fresh ? CSV_URL + '?fresh=' + Date.now() : CSV_URL;
    return fetch(url, fresh ? { cache: 'no-store' } : {}).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      if (fresh && res.headers.get('X-Carte-Offline')) throw new Error('offline');
      var lm = res.headers.get('last-modified');
      return res.arrayBuffer().then(function (buf) {
        var d = C.decodeBytes(buf);
        return { text: d.text, encoding: d.encoding, lastModified: lm };
      });
    });
  }

  function rememberList(p, lastModified) {
    var prev = readJSON(KEY_META) || {};
    var meta = {
      hash: p.hash,
      firstSeen: prev.hash === p.hash && prev.firstSeen ? prev.firstSeen : new Date().toISOString(),
      lastModified: lastModified || (prev.hash === p.hash ? prev.lastModified : null) || null
    };
    if (source === 'file') store.set(KEY_META, JSON.stringify(meta));
    listMeta = meta;
  }

  function applyParsed(p) {
    parsed = p;
    var summary = C.syncSession(session, parsed);
    // la carta mostrata resta visibile anche se tolta dal file: è già stata vista
    saveSession();
    return summary;
  }

  function startWithFile() {
    return fetchCsv(false).then(function (r) {
      source = 'file';
      var p = C.parseQuestions(r.text);
      rememberList(p, r.lastModified);
      return p;
    });
  }

  function init() {
    loadSession();
    if (!store.available) {
      showNotice('Memoria del browser non disponibile (forse navigazione privata): se chiudi la pagina le carte ripartono da capo.');
    }

    var imported = readJSON(KEY_IMPORT);
    var loading;
    if (imported && typeof imported.text === 'string') {
      source = 'import';
      var p = C.parseQuestions(imported.text);
      listMeta = { hash: p.hash, firstSeen: imported.savedAt, lastModified: null };
      loading = Promise.resolve(p);
    } else {
      loading = startWithFile();
    }

    loading.then(function (p) {
      if (p.total === 0) { renderFatal(p.errors); return; }
      applyParsed(p);
      render(true);
      if (p.errors.length) {
        showNotice(p.errors[0].message + (p.errors.length > 1 ? ' (e altri ' + (p.errors.length - 1) + ' problemi)' : '') +
          ' Vedi "Controlla l\'elenco domande" nel menu.');
      }
      if (source === 'file') checkForUpdate();
    }).catch(function (e) {
      renderFatal([{ line: 0, message: 'Non riesco a caricare il file domande.csv (' + e.message + '). ' +
        'Serve una connessione la prima volta che apri l\'app.' }]);
    });

    bindEvents();
    registerServiceWorker();
    keepAwake();
  }

  // Controlla in background se sul server c'è un domande.csv diverso.
  function checkForUpdate() {
    if (navigator.onLine === false) return;
    fetchCsv(true).then(function (r) {
      var p = C.parseQuestions(r.text);
      if (p.total > 0 && parsed && p.hash !== parsed.hash) {
        updateAvailable = true;
        $('menu-dot').hidden = false;
        $('update-btn').classList.add('highlight');
        $('update-btn').textContent = 'Aggiorna domande (nuovo elenco disponibile)';
      }
    }).catch(function () { /* offline: resta la copia in cache */ });
  }

  /* ---------- rendering ---------- */

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'className') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function render(animate) {
    if (!parsed) return;
    var card = $('card');
    var body = $('card-body');
    var cur = session.current;
    body.textContent = '';

    if (!cur) {
      card.setAttribute('data-deck', '');
      $('band-name').textContent = '';
      body.appendChild(el('p', { className: 'placeholder', text: 'Scegli un mazzo' }));
    } else if (cur.type === 'card') {
      card.setAttribute('data-deck', cur.deck);
      $('band-name').textContent = C.LABELS[cur.deck];
      var q = el('p', { className: 'question' + (animate ? ' fade' : ''), text: cur.text, lang: 'it' });
      body.appendChild(q);
      fitText();
    } else {
      card.setAttribute('data-deck', cur.deck);
      $('band-name').textContent = C.LABELS[cur.deck];
      var info = C.deckInfo(session, parsed, cur.deck);
      var btn = el('button', { className: 'action-btn', type: 'button', text: 'Rimescola questo mazzo' });
      btn.addEventListener('click', function () { onReshuffle(cur.deck); });
      body.appendChild(el('div', { className: 'finished' + (animate ? ' fade' : '') }, [
        el('h2', { text: 'Mazzo finito' }),
        el('p', { text: 'Hai visto tutte le ' + info.total + ' domande del mazzo ' + C.LABELS[cur.deck] + '. Gli altri mazzi continuano a funzionare.' }),
        btn
      ]));
    }

    var buttons = document.querySelectorAll('.deck-btn');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var d = b.getAttribute('data-deck');
      var inf = C.deckInfo(session, parsed, d);
      var label = inf.empty ? 'nessuna domanda' : inf.finished ? 'finito' : inf.remaining + (inf.remaining === 1 ? ' rimasta' : ' rimaste');
      b.querySelector('.count').textContent = ', ' + label;
      b.setAttribute('aria-label', C.LABELS[d] + ', ' + label);
      b.disabled = inf.empty;
      b.classList.toggle('is-finished', inf.finished);
    }
    $('back-btn').disabled = !session.previous;
  }

  // Adatta la dimensione del testo (da 36 a 22 px) per farlo stare tutto nella carta.
  function fitText() {
    var body = $('card-body');
    var q = body.querySelector('.question');
    if (!q) return;
    var fits = function () { return body.scrollHeight <= body.clientHeight + 1; };
    var lo = 22, hi = 36, best = 22;
    q.style.fontSize = hi + 'px';
    if (fits()) return;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      q.style.fontSize = mid + 'px';
      if (fits()) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    q.style.fontSize = best + 'px';
  }

  function renderFatal(errors) {
    $('card').setAttribute('data-deck', '');
    $('band-name').textContent = '';
    var body = $('card-body');
    body.textContent = '';
    var list = el('ul');
    errors.slice(0, 8).forEach(function (e) { list.appendChild(el('li', { text: e.message })); });
    if (errors.length > 8) list.appendChild(el('li', { text: '… e altri ' + (errors.length - 8) + ' problemi.' }));
    var retry = el('button', { className: 'action-btn', type: 'button', text: 'Riprova' });
    retry.addEventListener('click', function () { location.reload(); });
    body.appendChild(el('div', { className: 'error-box' }, [
      el('h2', { text: 'Problema con l\'elenco delle domande' }),
      list,
      el('p', {}, [el('a', { href: './?controllo', text: 'Apri la pagina di controllo' })]),
      retry
    ]));
    var buttons = document.querySelectorAll('.deck-btn');
    for (var i = 0; i < buttons.length; i++) buttons[i].disabled = true;
    $('back-btn').disabled = true;
  }

  function showNotice(text) {
    var n = $('notice');
    n.textContent = n.hidden || !n.textContent ? text : n.textContent + ' ' + text;
    n.hidden = false;
  }

  /* ---------- azioni ---------- */

  function onDeck(deck) {
    if (!parsed) return;
    C.drawCard(session, parsed, deck);
    saveSession();
    render(true);
    keepAwake();
  }

  function onBack() {
    if (C.goBack(session)) { saveSession(); render(true); }
  }

  function onReshuffle(deck) {
    if (!window.confirm('Rimescolare il mazzo ' + C.LABELS[deck] + '? Tutte le sue domande torneranno disponibili.')) return;
    C.reshuffle(session, parsed, deck);
    C.drawCard(session, parsed, deck);
    saveSession();
    render(true);
  }

  function onReset() {
    if (!window.confirm('Azzerare questo telefono? Tutti i mazzi ripartono da capo e le domande già viste potranno ricomparire.')) return;
    session = C.createSession();
    saveSession();
    closeMenu();
    render(true);
  }

  function describeSummary(s) {
    if (!s.added && !s.removed) return 'Domande aggiornate.';
    var parts = [];
    if (s.added) parts.push(s.added + (s.added === 1 ? ' nuova' : ' nuove'));
    if (s.removed) parts.push(s.removed + (s.removed === 1 ? ' tolta' : ' tolte'));
    return 'Domande aggiornate: ' + parts.join(', ') + '.';
  }

  function onUpdate() {
    var msg = $('update-msg');
    msg.textContent = 'Controllo in corso…';
    fetchCsv(true).then(function (r) {
      var p = C.parseQuestions(r.text);
      if (p.total === 0) {
        msg.textContent = 'Il nuovo file ha un problema e non è stato applicato: ' + (p.errors[0] ? p.errors[0].message : 'nessuna domanda.');
        return;
      }
      var wasImport = source === 'import';
      if (!wasImport && parsed && p.hash === parsed.hash) {
        msg.textContent = 'Le domande sono già aggiornate.';
      } else {
        source = 'file';
        store.remove(KEY_IMPORT);
        rememberList(p, r.lastModified);
        var s = applyParsed(p);
        msg.textContent = describeSummary(s) + (p.errors.length ? ' Attenzione: ' + p.errors.length + ' problemi nel file, vedi Controlla.' : '');
        render(false);
      }
      updateAvailable = false;
      $('menu-dot').hidden = true;
      $('update-btn').classList.remove('highlight');
      $('update-btn').textContent = 'Aggiorna domande';
      renderInfo();
    }).catch(function () {
      msg.textContent = 'Nessuna connessione: resta l\'elenco attuale.';
    });
  }

  function onImportApply() {
    var msg = $('import-msg');
    var text = $('import-text').value;
    var p = C.parseQuestions(text);
    if (p.total === 0) {
      msg.textContent = 'Non ho trovato domande valide. ' + (p.errors[0] ? p.errors[0].message : '');
      return;
    }
    var problems = p.errors.length ? ' Attenzione: ' + p.errors.map(function (e) { return e.message; }).join(' ') : '';
    var savedAt = new Date().toISOString();
    store.set(KEY_IMPORT, JSON.stringify({ text: text, savedAt: savedAt }));
    source = 'import';
    listMeta = { hash: p.hash, firstSeen: savedAt, lastModified: null };
    var s = applyParsed(p);
    msg.textContent = 'Importate ' + p.total + ' domande (' + countsText(p) + '). ' + describeSummary(s).replace('Domande aggiornate', 'Rispetto a prima') + problems;
    render(false);
    renderInfo();
  }

  function onImportClear() {
    if (!window.confirm('Tornare al file domande condiviso? Le domande importate su questo telefono verranno dimenticate.')) return;
    store.remove(KEY_IMPORT);
    startWithFile().then(function (p) {
      if (p.total === 0) { renderFatal(p.errors); return; }
      var s = applyParsed(p);
      $('import-msg').textContent = '';
      $('update-msg').textContent = 'Di nuovo sul file condiviso. ' + describeSummary(s).replace('Domande aggiornate', 'Rispetto alle importate');
      render(false);
      renderInfo();
    }).catch(function () {
      $('update-msg').textContent = 'Non riesco a leggere domande.csv: controlla la connessione.';
    });
  }

  function countsText(p) {
    return C.DECKS.map(function (d) { return C.LABELS[d] + ' ' + p.decks[d].length; }).join(', ');
  }

  function formatDate(iso) {
    if (!iso) return 'sconosciuta';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderInfo() {
    var info = $('info');
    info.textContent = '';
    var lines = ['Carte domande, versione ' + APP_VERSION];
    if (parsed) {
      lines.push((source === 'import' ? 'Domande importate su questo telefono' : 'Elenco domande del file condiviso') +
        ': ' + parsed.total + ' (' + countsText(parsed) + ')');
      if (listMeta) {
        lines.push(source === 'import'
          ? 'Importate il ' + formatDate(listMeta.firstSeen)
          : 'Data elenco: ' + formatDate(listMeta.lastModified || listMeta.firstSeen) +
            (listMeta.lastModified ? '' : ' (prima lettura su questo telefono)'));
      }
    }
    if (!store.available) lines.push('Memoria locale non disponibile: lo stato non viene salvato.');
    lines.forEach(function (t, i) {
      if (i) info.appendChild(document.createElement('br'));
      info.appendChild(document.createTextNode(t));
    });
    $('import-clear').hidden = source !== 'import';
  }

  /* ---------- menu ---------- */

  function openMenu() {
    renderInfo();
    var d = $('menu');
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }
  function closeMenu() {
    var d = $('menu');
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  function bindEvents() {
    var buttons = document.querySelectorAll('.deck-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) { onDeck(e.currentTarget.getAttribute('data-deck')); });
    }
    $('back-btn').addEventListener('click', onBack);
    $('menu-btn').addEventListener('click', openMenu);
    $('menu-close').addEventListener('click', closeMenu);
    $('menu').addEventListener('click', function (e) { if (e.target === e.currentTarget) closeMenu(); });
    $('reset-btn').addEventListener('click', onReset);
    $('update-btn').addEventListener('click', onUpdate);
    $('import-toggle').addEventListener('click', function () {
      var box = $('import-box');
      box.hidden = !box.hidden;
      $('import-toggle').setAttribute('aria-expanded', String(!box.hidden));
    });
    $('import-apply').addEventListener('click', onImportApply);
    $('import-clear').addEventListener('click', onImportClear);
    $('import-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      f.arrayBuffer().then(function (b) { $('import-text').value = C.decodeBytes(b).text; });
    });

    // Due schede aperte: l'ultima scrittura vince, l'altra si riallinea.
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY_SESSION || !parsed) return;
      session = C.restoreSession(readJSON(KEY_SESSION));
      C.syncSession(session, parsed);
      render(false);
    });

    if (window.ResizeObserver) new ResizeObserver(function () { fitText(); }).observe($('card-body'));
    else window.addEventListener('resize', fitText);

    document.addEventListener('visibilitychange', keepAwake);
  }

  /* ---------- schermo sempre acceso ---------- */

  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    if (wakeLock && !wakeLock.released) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* non supportato o negato */ });
  }

  /* ---------- service worker ---------- */

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* es. file:// o http senza TLS */ });
    });
  }

  /* ---------- pagina di controllo ---------- */

  function initCheck() {
    document.title = 'Controllo domande';
    $('app').hidden = true;
    var root = $('check');
    root.hidden = false;
    root.appendChild(el('p', {}, [el('a', { href: './', text: '← Torna alle carte' })]));
    root.appendChild(el('h1', { text: 'Controllo elenco domande' }));
    var status = el('p', { text: 'Lettura di domande.csv…' });
    root.appendChild(status);
    var out = el('div');
    root.appendChild(out);

    function show(text, origin) {
      out.textContent = '';
      var p = C.parseQuestions(text);
      status.textContent = origin;
      out.appendChild(el('p', {}, [
        el('span', { className: p.errors.length ? 'bad' : 'ok',
          text: p.errors.length ? p.errors.length + (p.errors.length === 1 ? ' errore' : ' errori') : 'Nessun errore' }),
        document.createTextNode(' · ' + p.total + ' domande lette (' + countsText(p) + ')' +
          (p.format ? ' · formato: ' + (p.format === 'csv' ? 'CSV' : 'elenco testuale') : ''))
      ]));
      function msgs(title, list) {
        if (!list.length) return;
        out.appendChild(el('h3', { text: title }));
        var ul = el('ul', { className: 'msgs' });
        list.forEach(function (m) { ul.appendChild(el('li', { text: m.message })); });
        out.appendChild(ul);
      }
      msgs('Errori', p.errors);
      msgs('Avvisi', p.warnings);
      C.DECKS.forEach(function (d) {
        out.appendChild(el('h2', { className: d, text: C.LABELS[d] + ' (' + p.decks[d].length + ')' }));
        var ol = el('ol');
        p.decks[d].forEach(function (q) {
          ol.appendChild(el('li', {}, [
            el('span', { className: 'ln', text: 'riga ' + q.line }),
            document.createTextNode(q.text + '  '),
            el('span', { className: 'ln', text: '(' + q.text.length + ' car.)' })
          ]));
        });
        out.appendChild(ol);
      });
    }

    fetchCsv(true).then(function (r) {
      show(r.text, 'File domande.csv pubblicato (letto ora dalla rete, codifica ' + r.encoding + ').');
    }).catch(function () {
      return fetchCsv(false).then(function (r) {
        show(r.text, 'File domande.csv dalla copia salvata (sei offline, codifica ' + r.encoding + ').');
      });
    }).catch(function (e) {
      status.textContent = 'Non riesco a leggere domande.csv: ' + e.message;
    });

    // prova di un altro file senza pubblicarlo
    root.appendChild(el('h2', { text: 'Prova un altro file' }));
    root.appendChild(el('p', { className: 'small', text: 'Incolla il testo o scegli un file: viene solo controllato, non cambia le carte.' }));
    var ta = el('textarea', { rows: '6', 'aria-label': 'Testo da controllare' });
    var file = el('input', { type: 'file', accept: '.csv,.txt,text/csv,text/plain', 'aria-label': 'File da controllare' });
    var go = el('button', { className: 'menu-item primary', type: 'button', text: 'Controlla questo testo' });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (f) f.arrayBuffer().then(function (b) {
        var d = C.decodeBytes(b);
        ta.value = d.text;
        show(d.text, 'File scelto: ' + f.name + ' (codifica ' + d.encoding + ').');
        window.scrollTo(0, 0);
      });
    });
    go.addEventListener('click', function () { show(ta.value, 'Testo incollato.'); window.scrollTo(0, 0); });
    root.appendChild(ta);
    root.appendChild(el('div', { className: 'row' }, [file, go]));
  }

  /* ---------- avvio ---------- */

  if (/[?&]controllo\b/.test(location.search)) {
    initCheck();
    registerServiceWorker();
  } else {
    init();
  }
})();
