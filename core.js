/*
 * Carte domande CdG - logica pura (nessun accesso a DOM o rete).
 * Usata dal browser (window.CarteCore) e dai test in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CarteCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';
  var DECKS = ['leggero', 'medio', 'personale'];
  var LABELS = { leggero: 'Leggero', medio: 'Medio', personale: 'Personale' };

  /* ---------- testo e identificativi ---------- */

  function normalizeText(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFC');
    return s.replace(/[\s ]+/g, ' ').trim();
  }

  // Chiave usata per l'hash: ignora maiuscole e differenze tra apostrofi/virgolette tipografiche.
  function idKey(s) {
    return normalizeText(s)
      .toLowerCase()
      .replace(/[‘’‛`´]/g, "'")
      .replace(/[“”„«»]/g, '"');
  }

  // FNV-1a su due semi diversi -> identificativo da ~52 bit, stabile tra dispositivi.
  function fnv(str, seed) {
    var h = seed >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function hashString(str) {
    var a = fnv(str, 2166136261);
    var b = fnv(str, 0x9747b28c) & 0xfffff; // 20 bit
    return a.toString(36) + b.toString(36);
  }
  function hashId(text) {
    return 'q' + hashString(idKey(text));
  }

  function parseLevel(raw) {
    var k = normalizeText(raw).replace(/^"+|"+$/g, '').replace(/\s+/g, '').toLowerCase();
    return DECKS.indexOf(k) >= 0 ? k : null;
  }

  /* ---------- parser ---------- */

  var HEADER_RE = /^"?\s*livello\s*"?\s*([,;\t])\s*"?\s*domanda\s*"?\s*(?:[,;\t].*)?$/i;
  var HEADERLESS_RE = /^\s*"?\s*(leggero|medio|personale)\s*"?\s*([,;\t])/i;

  // Legge un CSV riga per riga, rispettando le virgolette (anche su più righe).
  function readCsvRecords(lines, start, sep, onRecord) {
    var i = start;
    while (i < lines.length) {
      var lineNo = i + 1;
      var line = lines[i];
      var fields = [];
      var field = '';
      var inQ = false;
      var j = 0;
      for (;;) {
        if (j >= line.length) {
          if (inQ && i + 1 < lines.length) {
            field += '\n';
            i++;
            line = lines[i];
            j = 0;
            continue;
          }
          break;
        }
        var c = line.charAt(j);
        if (inQ) {
          if (c === '"') {
            if (line.charAt(j + 1) === '"') { field += '"'; j += 2; continue; }
            inQ = false; j++; continue;
          }
          field += c; j++; continue;
        }
        if (c === '"' && field.trim() === '') { inQ = true; field = ''; j++; continue; }
        if (c === sep) { fields.push(field); field = ''; j++; continue; }
        field += c; j++;
      }
      fields.push(field);
      onRecord(fields, lineNo, inQ);
      i++;
    }
  }

  /**
   * Interpreta il testo del file domande.
   * Restituisce { decks: {leggero:[{id,text,line}],...}, errors:[{line,message}],
   *               warnings:[{line,message}], format, total, hash }
   */
  function parseQuestions(input) {
    var res = {
      decks: { leggero: [], medio: [], personale: [] },
      errors: [],
      warnings: [],
      format: null,
      total: 0,
      hash: ''
    };
    var text = typeof input === 'string' ? input : '';
    text = text.replace(/^﻿/, '');
    var lines = text.split(/\r\n|\r|\n/);
    var seen = { leggero: {}, medio: {}, personale: {} };

    function err(line, message) { res.errors.push({ line: line, message: message }); }
    function warn(line, message) { res.warnings.push({ line: line, message: message }); }

    function add(level, raw, line) {
      var q = normalizeText(raw);
      if (!q) { warn(line, 'Riga ' + line + ': domanda vuota, ignorata.'); return; }
      var id = hashId(q);
      if (seen[level][id]) {
        warn(line, 'Riga ' + line + ': domanda duplicata nel mazzo ' + LABELS[level] +
          ' (già alla riga ' + seen[level][id] + '), ignorata.');
        return;
      }
      seen[level][id] = line;
      if (q.length > 200) {
        warn(line, 'Riga ' + line + ': domanda molto lunga (' + q.length + ' caratteri), potrebbe non stare sullo schermo.');
      }
      res.decks[level].push({ id: id, text: q, line: line });
    }

    function unknownLevel(raw, line) {
      err(line, 'Riga ' + line + ': livello "' + normalizeText(raw) +
        '" non riconosciuto. Valori ammessi: leggero, medio, personale.');
    }

    var first = -1;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t && t.indexOf('//') !== 0) { first = i; break; }
    }

    if (first < 0) {
      err(0, 'Il file delle domande è vuoto.');
    } else {
      var head = lines[first].trim();
      var m = HEADER_RE.exec(head);
      var hl = HEADERLESS_RE.exec(head);
      var csvStart = -1;
      var sep = ',';
      if (m) {
        res.format = 'csv';
        sep = m[1];
        csvStart = first + 1;
      } else if (hl) {
        res.format = 'csv';
        sep = hl[2];
        csvStart = first;
        warn(first + 1, 'Manca la riga di intestazione "livello,domanda": ho letto il file come CSV senza intestazione.');
      } else if (lines.some(function (l) { return /^\s*#/.test(l); })) {
        res.format = 'testo';
      } else {
        err(first + 1, 'Riga ' + (first + 1) + ': intestazione non riconosciuta. ' +
          'La prima riga deve essere "livello,domanda" (oppure usa il formato elenco, ' +
          'con le righe "# Leggero", "# Medio", "# Personale" come titoli).');
      }

      if (res.format === 'csv') {
        readCsvRecords(lines, csvStart, sep, function (fields, line, unterminated) {
          // togli le colonne vuote in coda (Excel aggiunge ";;")
          while (fields.length > 1 && fields[fields.length - 1].trim() === '') fields.pop();
          if (fields.length === 1 && fields[0].trim() === '') return; // riga vuota
          if (fields[0].trim().indexOf('//') === 0) return; // commento
          // Excel che apre il CSV come colonna unica salva ogni riga tra virgolette:
          // "leggero,""Domanda, con virgola""" -> rileggo il contenuto come riga CSV.
          if (!unterminated && fields.length === 1 && !parseLevel(fields[0]) && fields[0].indexOf(sep) > 0) {
            var inner = null;
            readCsvRecords([fields[0]], 0, sep, function (f, l, u) { if (!u) inner = f; });
            if (inner && inner.length > 1 && parseLevel(inner[0])) fields = inner;
          }
          if (unterminated) {
            err(line, 'Riga ' + line + ': virgolette aperte e mai chiuse.');
            return;
          }
          var level = parseLevel(fields[0]);
          if (!level) { unknownLevel(fields[0], line); return; }
          if (fields.length < 2) {
            err(line, 'Riga ' + line + ': manca il testo della domanda dopo "' + normalizeText(fields[0]) + '".');
            return;
          }
          // virgole non racchiuse tra virgolette: le rimetto nel testo
          add(level, fields.slice(1).join(sep), line);
        });
      } else if (res.format === 'testo') {
        var current = null; // null = nessuna sezione; false = sezione non valida
        var outsideReported = false;
        for (var k = 0; k < lines.length; k++) {
          var ln = k + 1;
          var s = lines[k].replace(/^﻿/, '').trim();
          if (!s || s.indexOf('//') === 0) continue;
          var h = /^#+\s*(.*)$/.exec(s);
          if (h) {
            var lv = parseLevel(h[1]);
            if (lv) current = lv;
            else { unknownLevel(h[1], ln); current = false; }
            continue;
          }
          if (current === false) continue;
          if (current === null) {
            if (!outsideReported) {
              err(ln, 'Riga ' + ln + ': domanda fuori da una sezione. Metti prima un titolo come "# Leggero".');
              outsideReported = true;
            }
            continue;
          }
          add(current, s.replace(/^(?:[-*•]|\d+[.)])\s+/, ''), ln);
        }
      }
    }

    var allIds = [];
    DECKS.forEach(function (d) {
      res.total += res.decks[d].length;
      if (res.decks[d].length === 0 && res.format) {
        err(0, 'Il mazzo ' + LABELS[d] + ' è vuoto: nessuna domanda con livello "' + d + '".');
      }
      res.decks[d].forEach(function (q) { allIds.push(d + ':' + q.id); });
    });
    res.hash = hashString(allIds.join('|'));
    return res;
  }

  /**
   * Decodifica i byte del file: UTF-8 (con o senza BOM), altrimenti Windows-1252
   * (quello che usa Excel su Windows con "CSV (delimitato dal separatore di elenco)").
   */
  function decodeBytes(buf) {
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
    }
  }

  /* ---------- code e sessione ---------- */

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function idsOf(parsed, deck) {
    return parsed.decks[deck].map(function (q) { return q.id; });
  }

  function textOf(parsed, deck, id) {
    var list = parsed.decks[deck];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].text;
    return null;
  }

  function newDeckState(ids, rng) {
    return { queue: shuffle(ids, rng), pos: 0 };
  }

  /**
   * Allinea una coda a un nuovo elenco di domande:
   * - le domande già estratte restano estratte (anche se tolte dal file);
   * - quelle tolte e non ancora estratte spariscono;
   * - quelle nuove entrano in posizione casuale nella parte non ancora estratta.
   */
  function mergeDeck(state, ids, rng) {
    rng = rng || Math.random;
    var exists = {};
    ids.forEach(function (id) { exists[id] = true; });
    var pos = Math.max(0, Math.min(state.pos | 0, state.queue.length));
    var used = [];
    var usedSet = {};
    state.queue.slice(0, pos).forEach(function (id) {
      if (!usedSet[id]) { usedSet[id] = true; used.push(id); }
    });
    var oldRest = state.queue.slice(pos);
    var rest = [];
    var restSet = {};
    oldRest.forEach(function (id) {
      if (exists[id] && !usedSet[id] && !restSet[id]) { restSet[id] = true; rest.push(id); }
    });
    var removed = oldRest.length - rest.length;
    var added = 0;
    ids.forEach(function (id) {
      if (!usedSet[id] && !restSet[id]) {
        var k = Math.floor(rng() * (rest.length + 1));
        rest.splice(k, 0, id);
        restSet[id] = true;
        added++;
      }
    });
    return { state: { queue: used.concat(rest), pos: used.length }, added: added, removed: removed };
  }

  function createSession() {
    return { v: 1, decks: {}, current: null, previous: null };
  }

  function isCardRef(x) {
    return !!x && typeof x === 'object' && DECKS.indexOf(x.deck) >= 0 &&
      (x.type === 'finished' || (x.type === 'card' && typeof x.text === 'string'));
  }

  // Ricostruisce una sessione valida da dati salvati (anche corrotti).
  function restoreSession(data) {
    var s = createSession();
    if (!data || typeof data !== 'object' || data.v !== 1) return s;
    DECKS.forEach(function (d) {
      var ds = data.decks && data.decks[d];
      if (ds && Array.isArray(ds.queue) && typeof ds.pos === 'number') {
        var q = ds.queue.filter(function (x) { return typeof x === 'string'; });
        s.decks[d] = { queue: q, pos: Math.max(0, Math.min(Math.floor(ds.pos), q.length)) };
      }
    });
    if (isCardRef(data.current)) s.current = data.current;
    if (isCardRef(data.previous) && data.previous.type === 'card') s.previous = data.previous;
    return s;
  }

  // Applica un elenco di domande (nuovo o aggiornato) a una sessione esistente.
  function syncSession(session, parsed, rng) {
    var summary = { added: 0, removed: 0 };
    DECKS.forEach(function (d) {
      if (!session.decks[d]) return; // mazzo non ancora usato: la coda si crea al primo tocco
      var r = mergeDeck(session.decks[d], idsOf(parsed, d), rng);
      session.decks[d] = r.state;
      summary.added += r.added;
      summary.removed += r.removed;
    });
    return summary;
  }

  function deckInfo(session, parsed, deck) {
    var total = parsed.decks[deck].length;
    var ds = session.decks[deck];
    var remaining = ds ? ds.queue.length - ds.pos : total;
    return { total: total, remaining: remaining, finished: total > 0 && remaining <= 0, empty: total === 0 };
  }

  function show(session, next) {
    if (session.current && session.current.type === 'card') session.previous = session.current;
    session.current = next;
  }

  // Estrae la prossima carta del mazzo. Restituisce quello che va mostrato.
  function drawCard(session, parsed, deck, rng) {
    if (!session.decks[deck]) session.decks[deck] = newDeckState(idsOf(parsed, deck), rng);
    var ds = session.decks[deck];
    var next;
    while (ds.pos < ds.queue.length) {
      var id = ds.queue[ds.pos++];
      var text = textOf(parsed, deck, id);
      if (text !== null) { next = { type: 'card', deck: deck, id: id, text: text }; break; }
    }
    if (!next) next = { type: 'finished', deck: deck };
    show(session, next);
    return next;
  }

  function goBack(session) {
    if (!session.previous) return false;
    session.current = session.previous;
    session.previous = null;
    return true;
  }

  function reshuffle(session, parsed, deck, rng) {
    session.decks[deck] = newDeckState(idsOf(parsed, deck), rng);
  }

  return {
    VERSION: VERSION,
    DECKS: DECKS,
    LABELS: LABELS,
    normalizeText: normalizeText,
    hashId: hashId,
    hashString: hashString,
    parseLevel: parseLevel,
    parseQuestions: parseQuestions,
    decodeBytes: decodeBytes,
    shuffle: shuffle,
    newDeckState: newDeckState,
    mergeDeck: mergeDeck,
    createSession: createSession,
    restoreSession: restoreSession,
    syncSession: syncSession,
    deckInfo: deckInfo,
    drawCard: drawCard,
    goBack: goBack,
    reshuffle: reshuffle,
    textOf: textOf
  };
});
