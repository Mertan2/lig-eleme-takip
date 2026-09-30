/* Durum + localStorage kalıcılığı + eski sürüm göçü. */
(function (global) {
  'use strict';

  var util = global.LIG.util;
  var KEY = 'ligApp_v4';
  var OLD_KEYS = ['ligApp_v3', 'ligApp_v2', 'ligApp_v1'];
  var VERSION = 4;

  /* Turnuvanın parçası olan, herkeste aynı olması gereken ayarlar. */
  var DEFAULT_SETTINGS = {
    pointsPerGame: 5,    // bir oyun kaç sayıya oynanır (sadece detaylı giriş)
    gamesToWinSet: 3,    // seti almak için gereken oyun (3 -> 3-0 / 3-1 / 3-2)
    setsToWinMatch: 2,   // maçı almak için gereken set (2 -> best of 3)
    doubleRound: true,   // çift devreli lig
    winPoints: 2,        // galibiyet puanı
    lossPoints: 0,       // mağlubiyet puanı
    playoffSize: 8       // elemeye çıkan oyuncu sayısı
  };

  /* Cihaza özel tercihler — paylaşılmaz, senkronize edilmez. */
  var PREFS_KEY = 'ligPrefs_v1';
  var DEFAULT_PREFS = {
    theme: 'auto',       // auto | light | dark
    inputMode: 'fast'    // fast = set skoru | detailed = oyun oyun sayı girişi
  };

  function blank() {
    return {
      v: VERSION,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      players: [],
      matches: [],
      playoffRound: 0
    };
  }

  /* Eski oyun-bazlı set yapısı ({games:[{a,b}]}) -> {a,b,games} */
  function gamesToSetScore(set, gamesToWinSet) {
    var games = (set && Array.isArray(set.games)) ? set.games : null;
    if (!games || !games.length) return null;
    var a = 0, b = 0, keep = [];
    for (var i = 0; i < games.length; i++) {
      var g = { a: Number(games[i].a) || 0, b: Number(games[i].b) || 0 };
      keep.push(g);
      if (g.a > g.b) a++; else if (g.b > g.a) b++;
    }
    // Yarım kalmış setler taşınmaz — yeni modelde set ya bitmiştir ya da yoktur.
    if (a < gamesToWinSet && b < gamesToWinSet) return null;
    return { a: a, b: b, games: keep };
  }

  /* v3'te sadece set skoru vardı; oyun skorları bilinmiyor, yaklaşık üretilir. */
  function scoreToSets(score, gamesToWinSet) {
    if (!score) return [];
    var out = [];
    for (var i = 0; i < score.b; i++) out.push({ a: 0, b: gamesToWinSet });
    for (var j = 0; j < score.a; j++) out.push({ a: gamesToWinSet, b: 0 });
    return out;
  }

  function migrateOld(old) {
    var s = blank();
    var os = old.settings || {};
    s.settings.pointsPerGame = util.clampInt(os.pointsPerGame, 1, 99, 5);
    s.settings.gamesToWinSet = util.clampInt(os.gamesToWinSet, 1, 5, 3);
    s.settings.setsToWinMatch = util.clampInt(os.setsToWinMatch, 1, 5, 2);
    if (os.doubleRound !== undefined) s.settings.doubleRound = !!os.doubleRound;
    if (os.winPoints !== undefined) s.settings.winPoints = util.clampInt(os.winPoints, 0, 10, 2);
    if (os.lossPoints !== undefined) s.settings.lossPoints = util.clampInt(os.lossPoints, 0, 10, 0);
    if (os.playoffSize !== undefined) s.settings.playoffSize = Number(os.playoffSize);

    s.players = (Array.isArray(old.players) ? old.players : [])
      .filter(function (p) { return p && p.id; })
      .map(function (p) { return { id: String(p.id), name: String(p.name || 'Oyuncu') }; });

    s.matches = (Array.isArray(old.matches) ? old.matches : [])
      .filter(function (m) { return m && m.id && m.p1; })
      .map(function (m, i) {
        var list = [];
        if (Array.isArray(m.sets) && m.sets.length && m.sets[0] && m.sets[0].games !== undefined) {
          // v1/v2: oyun oyun girilmiş setler
          m.sets.forEach(function (st) {
            var sc = gamesToSetScore(st, s.settings.gamesToWinSet);
            if (sc) list.push(sc);
          });
        } else if (Array.isArray(m.sets)) {
          list = m.sets.filter(function (st) { return st && isFinite(st.a) && isFinite(st.b); })
            .map(function (st) {
              var out = { a: Number(st.a), b: Number(st.b) };
              if (Array.isArray(st.games)) {
                out.games = st.games.map(function (g) { return { a: Number(g.a) || 0, b: Number(g.b) || 0 }; });
              }
              return out;
            });
        } else if (m.score) {
          // v3: sadece set skoru vardı
          list = scoreToSets({ a: Number(m.score.a) || 0, b: Number(m.score.b) || 0 }, s.settings.gamesToWinSet);
        }
        return {
          id: String(m.id),
          phase: m.phase === 'eleme' ? 'eleme' : 'lig',
          round: m.round != null ? Number(m.round) : 1,
          order: m.order != null ? Number(m.order) : i,
          p1: String(m.p1),
          p2: m.p2 == null ? null : String(m.p2),
          sets: list
        };
      });

    s.playoffRound = Number(old.playoffRound) || 0;
    return s;
  }

  function sanitize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var s = blank();
    s.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings || {});
    s.settings.pointsPerGame = util.clampInt(s.settings.pointsPerGame, 1, 99, 5);
    s.settings.gamesToWinSet = util.clampInt(s.settings.gamesToWinSet, 1, 5, 3);
    s.settings.setsToWinMatch = util.clampInt(s.settings.setsToWinMatch, 1, 5, 2);
    // Cihaz tercihleri eski kayıtlarda settings içindeydi; ayıklanır.
    delete s.settings.theme;
    delete s.settings.inputMode;
    s.settings.winPoints = util.clampInt(s.settings.winPoints, 0, 10, 2);
    s.settings.lossPoints = util.clampInt(s.settings.lossPoints, 0, 10, 0);
    s.settings.playoffSize = [2, 4, 8, 16, 32].indexOf(Number(s.settings.playoffSize)) >= 0
      ? Number(s.settings.playoffSize) : 8;
    s.settings.doubleRound = !!s.settings.doubleRound;

    s.players = (Array.isArray(raw.players) ? raw.players : [])
      .filter(function (p) { return p && p.id; })
      .map(function (p) { return { id: String(p.id), name: String(p.name || 'Oyuncu').slice(0, 40) }; });

    var known = {};
    s.players.forEach(function (p) { known[p.id] = true; });
    var maxSets = s.settings.setsToWinMatch * 2 - 1;

    s.matches = (Array.isArray(raw.matches) ? raw.matches : [])
      .filter(function (m) { return m && m.id && m.p1 && known[m.p1] && (m.p2 == null || known[m.p2]); })
      .map(function (m, i) {
        var list = (Array.isArray(m.sets) ? m.sets : [])
          .filter(function (st) { return st && isFinite(st.a) && isFinite(st.b); })
          .map(function (st) {
            var out = { a: util.clampInt(st.a, 0, 99, 0), b: util.clampInt(st.b, 0, 99, 0) };
            if (Array.isArray(st.games) && st.games.length) {
              out.games = st.games
                .filter(function (g) { return g && isFinite(g.a) && isFinite(g.b); })
                .map(function (g) { return { a: util.clampInt(g.a, 0, 999, 0), b: util.clampInt(g.b, 0, 999, 0) }; });
            }
            return out;
          })
          .slice(0, maxSets);
        return {
          id: String(m.id),
          phase: m.phase === 'eleme' ? 'eleme' : 'lig',
          round: util.clampInt(m.round, 1, 999, 1),
          order: util.clampInt(m.order, 0, 9999, i),
          p1: String(m.p1),
          p2: m.p2 == null ? null : String(m.p2),
          sets: list
        };
      });

    s.playoffRound = util.clampInt(raw.playoffRound, 0, 99, 0);
    return s;
  }

  function persist(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      return true;
    } catch (e) {
      console.warn('Kayıt yazılamadı:', e);
      util.toast('Veri kaydedilemedi (depolama dolu veya engelli).', 'err');
      return false;
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return sanitize(JSON.parse(raw)) || blank();
      for (var i = 0; i < OLD_KEYS.length; i++) {
        var old = localStorage.getItem(OLD_KEYS[i]);
        if (!old) continue;
        var migrated = sanitize(migrateOld(JSON.parse(old)));
        if (migrated) { persist(migrated); return migrated; }
      }
    } catch (e) {
      console.warn('Kayıt okunamadı:', e);
    }
    return blank();
  }

  function loadPrefs() {
    var p = Object.assign({}, DEFAULT_PREFS);
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) Object.assign(p, JSON.parse(raw) || {});
      else {
        // Eski sürümlerde tercihler settings içindeydi.
        var legacy = localStorage.getItem(KEY) || localStorage.getItem('ligApp_v3');
        if (legacy) {
          var ls = (JSON.parse(legacy) || {}).settings || {};
          if (ls.theme) p.theme = ls.theme;
          if (ls.inputMode) p.inputMode = ls.inputMode;
        }
      }
    } catch (e) { /* varsayılanlarla devam */ }
    if (['auto', 'light', 'dark'].indexOf(p.theme) < 0) p.theme = 'auto';
    if (['fast', 'detailed'].indexOf(p.inputMode) < 0) p.inputMode = 'fast';
    return p;
  }

  var state = load();
  var prefs = loadPrefs();

  var Store = {
    KEY: KEY,
    VERSION: VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    get state() { return state; },
    get settings() { return state.settings; },
    get prefs() { return prefs; },
    savePrefs: function () {
      try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* yoksay */ }
    },
    save: function () { return persist(state); },
    /* Yerel kaydet + bağlıysa değişikliği buluta kuyrukla. */
    commit: function (patch) {
      var ok = persist(state);
      if (patch && global.LIG.sync) global.LIG.sync.queue(patch);
      return ok;
    },
    /* Sık kullanılan patch'ler. */
    patch: {
      players: function () { return { players: state.players }; },
      match: function (m) { return { matchUpsert: [m] }; },
      allMatches: function () { return { matchesReplace: state.matches, playoffRound: state.playoffRound }; },
      setting: function (key, value) { var o = {}; o[key] = value; return { settings: o }; },
      everything: function () { return { replaceAll: state }; }
    },
    replace: function (next) {
      var clean = sanitize(next);
      if (!clean) return false;
      state = clean;
      return persist(state);
    },
    resetAll: function () { state = blank(); persist(state); return state; },
    playerById: function (id) {
      for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
      return null;
    },
    playerName: function (id) {
      if (id == null) return 'BAY';
      var p = Store.playerById(id);
      return p ? p.name : 'Silinmiş oyuncu';
    },
    matchById: function (id) {
      for (var i = 0; i < state.matches.length; i++) if (state.matches[i].id === id) return state.matches[i];
      return null;
    },
    newMatch: function (phase, p1, p2, round, order) {
      return {
        id: util.uid(),
        phase: phase,
        round: round || 1,
        order: order || 0,
        p1: p1,
        p2: p2 === undefined ? null : p2,
        sets: []
      };
    },
    exportJSON: function () {
      return JSON.stringify({ exportedAt: new Date().toISOString(), data: state }, null, 2);
    },
    importJSON: function (text) {
      var parsed = JSON.parse(text);
      var payload = parsed && parsed.data ? parsed.data : parsed;
      if (!payload || !Array.isArray(payload.players)) throw new Error('Geçersiz yedek dosyası.');
      var ready = payload.v === VERSION ? payload : migrateOld(payload);
      if (!Store.replace(ready)) throw new Error('Yedek yüklenemedi.');
    }
  };

  global.LIG.store = Store;
})(window);
