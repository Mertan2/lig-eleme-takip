/* Bulut senkronizasyonu (Cloudflare Pages Functions + D1).
 *
 * Model: uygulama her zaman yerel state üzerinde çalışır ve anında localStorage'a yazar.
 * Bir turnuvaya bağlıysa her değişiklik ayrıca "patch" olarak kuyruğa girer ve sunucuya
 * gönderilir. Sunucu patch'i güncel state'e uygular, yeni sürümü döner. Çevrimdışıyken
 * kuyruk birikir, bağlantı gelince sırayla boşalır — veri kaybı olmaz.
 *
 * Okuma herkese açık; yazma için PIN ile alınan token gerekir (doğrulama sunucuda).
 */
(function (global) {
  'use strict';

  var util = global.LIG.util;
  var store = global.LIG.store;

  var SYNC_KEY = 'ligSync_v1';
  var API = '/api';
  /* Tek ortak turnuva: siteyi açan herkes kod/link olmadan aynı tabloya bağlanır.
     URL'de #/t/KOD varsa o turnuva kullanılır (birden fazla turnuva istenirse). */
  var DEFAULT_CODE = 'MAIN';
  var FLUSH_DELAY = 600;        // ms, yazmaları topla
  var POLL_ACTIVE = 8000;       // ms, sekme görünürken
  var POLL_HIDDEN = 60000;      // ms, sekme arka plandayken
  var MAX_BACKOFF = 60000;

  var session = loadSession();
  var flushTimer = null;
  var pollTimer = null;
  var flushing = false;
  var backoff = 0;
  var listeners = [];

  function loadSession() {
    try {
      var raw = localStorage.getItem(SYNC_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || typeof s !== 'object') throw 0;
      return {
        code: s.code || null,
        name: s.name || '',
        token: s.token || null,
        expiresAt: Number(s.expiresAt) || 0,
        version: Number(s.version) || 0,
        queue: Array.isArray(s.queue) ? s.queue : [],
        status: 'local'
      };
    } catch (e) {
      return { code: null, name: '', token: null, expiresAt: 0, version: 0, queue: [], status: 'local' };
    }
  }

  function persistSession() {
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify({
        code: session.code, name: session.name, token: session.token,
        expiresAt: session.expiresAt, version: session.version, queue: session.queue
      }));
    } catch (e) { /* kota dolu olabilir; yerel state yine de yazılmış olur */ }
  }

  function setStatus(s) {
    if (session.status === s) return;
    session.status = s;
    emit();
  }

  function emit() {
    listeners.forEach(function (fn) { try { fn(publicState()); } catch (e) { console.warn(e); } });
  }

  function publicState() {
    return {
      connected: !!session.code,
      code: session.code,
      name: session.name,
      version: session.version,
      status: session.status,
      pending: session.queue.length,
      canWrite: canWrite()
    };
  }

  function canWrite() {
    if (!session.code) return true;                 // yerel mod: her şey serbest
    return !!session.token && session.expiresAt > Date.now() + 5000;
  }

  /* ---------- patch birleştirme ---------- */

  function coalesce(patches) {
    var out = { };
    var upserts = {};      // id -> match
    var removes = {};

    patches.forEach(function (p) {
      if (!p) return;
      if (p.replaceAll) {
        out = { replaceAll: p.replaceAll };
        upserts = {}; removes = {};
        return;
      }
      if (p.settings) out.settings = Object.assign(out.settings || {}, p.settings);
      if (p.players) out.players = p.players;
      if (p.matchesReplace) {
        out.matchesReplace = p.matchesReplace;
        upserts = {}; removes = {};   // toplu değişim öncekileri geçersiz kılar
      }
      if (p.matchUpsert) p.matchUpsert.forEach(function (m) { if (m && m.id) { upserts[m.id] = m; delete removes[m.id]; } });
      if (p.matchRemove) p.matchRemove.forEach(function (id) { removes[id] = true; delete upserts[id]; });
      if (typeof p.playoffRound === 'number') out.playoffRound = p.playoffRound;
    });

    var upsertList = Object.keys(upserts).map(function (k) { return upserts[k]; });
    var removeList = Object.keys(removes);
    if (upsertList.length) out.matchUpsert = upsertList;
    if (removeList.length) out.matchRemove = removeList;
    return out;
  }

  /* ---------- HTTP ---------- */

  function request(path, options) {
    options = options || {};
    var headers = { 'content-type': 'application/json' };
    if (options.auth && session.token) headers.authorization = 'Bearer ' + session.token;
    return fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (res) {
      return res.text().then(function (text) {
        var data;
        try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { error: 'bad_response', message: text.slice(0, 200) }; }
        if (!res.ok) {
          var err = new Error(data.message || ('HTTP ' + res.status));
          err.code = data.error || String(res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------- turnuva işlemleri ---------- */

  function create(name, pin, code) {
    return request('/tournaments', {
      method: 'POST',
      body: { name: name, pin: pin, code: code || undefined, state: store.state }
    })
      .then(function (res) {
        session.code = res.code;
        session.name = res.name;
        session.token = res.token;
        session.expiresAt = res.expiresAt;
        session.version = res.version;
        session.queue = [];
        persistSession();
        writeHash(res.code);
        setStatus('online');
        emit();
        return res;
      });
  }

  function join(code) {
    code = String(code || '').trim().toUpperCase();
    return request('/tournaments/' + encodeURIComponent(code)).then(function (res) {
      session.code = res.code;
      session.name = res.name;
      session.version = res.version;
      session.queue = [];
      if (!session.token || session.expiresAt < Date.now()) { session.token = null; session.expiresAt = 0; }
      persistSession();
      writeHash(res.code);
      store.replace(res.state);
      setStatus(canWrite() ? 'online' : 'readonly');
      emit();
      return res;
    });
  }

  function authenticate(pin) {
    if (!session.code) return Promise.reject(new Error('Bağlı turnuva yok.'));
    return request('/tournaments/' + session.code + '/auth', { method: 'POST', body: { pin: pin } })
      .then(function (res) {
        session.token = res.token;
        session.expiresAt = res.expiresAt;
        persistSession();
        setStatus('online');
        emit();
        flushSoon();
        return res;
      });
  }

  function signOut() {
    session.token = null;
    session.expiresAt = 0;
    persistSession();
    setStatus('readonly');
    emit();
  }

  function leave() {
    session = { code: null, name: '', token: null, expiresAt: 0, version: 0, queue: [], status: 'local' };
    persistSession();
    writeHash(null);
    stopPolling();
    emit();
  }

  function refresh() {
    if (!session.code) return Promise.resolve(null);
    return request('/tournaments/' + session.code).then(function (res) {
      session.name = res.name;
      session.version = res.version;
      persistSession();
      store.replace(res.state);
      setStatus(canWrite() ? 'online' : 'readonly');
      emit();
      return res;
    });
  }

  /* ---------- kuyruk ---------- */

  function queue(patch) {
    if (!session.code || !patch) return;
    session.queue.push(patch);
    persistSession();
    emit();
    flushSoon();
  }

  function flushSoon() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_DELAY);
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (flushing || !session.code || !session.queue.length) return Promise.resolve();
    if (!canWrite()) { setStatus('readonly'); return Promise.resolve(); }

    flushing = true;
    setStatus('syncing');
    var sending = session.queue.slice();
    var patch = coalesce(sending);

    return request('/tournaments/' + session.code + '/patch', {
      method: 'POST', auth: true, body: { patch: patch, baseVersion: session.version }
    }).then(function (res) {
      session.queue = session.queue.slice(sending.length);
      session.version = res.version;
      persistSession();
      backoff = 0;
      if (!session.queue.length) {
        store.replace(res.state);
        setStatus('online');
        emit();
        notifyState();
      } else {
        flushSoon();
      }
    }).catch(function (err) {
      if (err.status === 401) {
        session.token = null; session.expiresAt = 0;
        persistSession();
        setStatus('readonly');
        util.toast('Yazma oturumu doldu. PIN ile tekrar giriş yapın.', 'err');
      } else if (err.status >= 400 && err.status < 500 && err.status !== 429) {
        session.queue = session.queue.slice(sending.length);   // sunucu kalıcı olarak reddetti
        persistSession();
        util.toast('Değişiklik gönderilemedi: ' + err.message, 'err');
        setStatus('online');
      } else {
        backoff = Math.min(MAX_BACKOFF, backoff ? backoff * 2 : 2000);
        setStatus('offline');
        setTimeout(flush, backoff);
      }
    }).then(function () {
      flushing = false;
      emit();
    });
  }

  /* ---------- yoklama ---------- */

  function poll() {
    if (!session.code || flushing || session.queue.length) return;
    request('/tournaments/' + session.code + '/version').then(function (res) {
      if (res.version === session.version) {
        if (session.status === 'offline') setStatus(canWrite() ? 'online' : 'readonly');
        return;
      }
      return refresh().then(notifyState);
    }).catch(function () { setStatus('offline'); });
  }

  function schedulePoll() {
    stopPolling();
    if (!session.code) return;
    var every = document.hidden ? POLL_HIDDEN : POLL_ACTIVE;
    pollTimer = setInterval(poll, every);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  var stateListeners = [];
  function onRemoteState(fn) { stateListeners.push(fn); }
  function notifyState() { stateListeners.forEach(function (fn) { try { fn(); } catch (e) { console.warn(e); } }); }

  /* ---------- URL ---------- */

  function readHash() {
    var m = /^#\/t\/([A-Za-z0-9]{4,12})/.exec(location.hash || '');
    return m ? m[1].toUpperCase() : null;
  }

  /* Ortak turnuvada adres sade kalır; sadece farklı bir turnuvada kod yazılır. */
  function writeHash(code) {
    var want = (code && code !== DEFAULT_CODE) ? '#/t/' + code : '';
    if ((location.hash || '') === want) return;
    history.replaceState(null, '', want || (location.pathname + location.search));
  }

  /* ---------- başlangıç ---------- */

  function init() {
    var urlCode = readHash();
    var target = urlCode || session.code || DEFAULT_CODE;

    if (urlCode && session.code && urlCode !== session.code) {
      // Başka bir turnuvanın linki açıldı: o turnuvaya geç.
      session.token = null; session.expiresAt = 0; session.queue = [];
    }
    session.code = target;
    setStatus('offline');
    schedulePoll();

    return join(target)
      .then(function () { return session.queue.length ? flush() : null; })
      .then(notifyState)
      .catch(function (err) {
        if (err.status === 404) {
          // Ortak turnuva henüz kurulmamış: ilk açan kişi kurar.
          session.code = null;
          session.token = null; session.expiresAt = 0; session.queue = [];
          persistSession();
          setStatus('setup');
          emit();
        } else {
          setStatus('offline');   // çevrimdışı: yerel kopya ile devam
        }
      });
  }

  document.addEventListener('visibilitychange', function () {
    schedulePoll();
    if (!document.hidden) { poll(); flush(); }
  });
  global.addEventListener('online', function () { backoff = 0; poll(); flush(); });
  global.addEventListener('offline', function () { setStatus('offline'); });
  global.addEventListener('beforeunload', function () { if (session.queue.length) flush(); });

  global.LIG.sync = {
    init: init,
    state: publicState,
    onChange: function (fn) { listeners.push(fn); },
    onRemoteState: onRemoteState,
    create: create,
    join: join,
    authenticate: authenticate,
    refresh: refresh,
    leave: leave,
    signOut: signOut,
    queue: queue,
    flush: flush,
    canWrite: canWrite,
    isConnected: function () { return !!session.code; },
    defaultCode: DEFAULT_CODE,
    needsSetup: function () { return session.status === 'setup'; },
    shareUrl: function () {
      return session.code ? location.origin + location.pathname + '#/t/' + session.code : '';
    }
  };
})(window);
