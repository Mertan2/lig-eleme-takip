/* Olay bağlama ve komutlar. */
(function (global) {
  'use strict';

  var L = global.LIG;
  var util = L.util, store = L.store, rules = L.rules;
  var schedule = L.schedule, standings = L.standings, playoffs = L.playoffs, ui = L.ui;
  var view = ui.view;

  function commitAndRender(patch) { store.commit(patch); ui.render(); }

  /* Bağlı turnuvada yazma izni yoksa PIN iste ve işlemi durdur. */
  function requireWrite() {
    if (!L.sync || !L.sync.isConnected() || L.sync.canWrite()) return true;
    askPin();
    return false;
  }
  function norm(s) { return String(s).trim().toLocaleLowerCase('tr'); }

  /* ---------- oyuncular ---------- */

  function addPlayer() {
    var input = util.el('newPlayerName');
    if (!input) return;
    var name = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) { input.focus(); return; }
    if (store.state.players.some(function (p) { return norm(p.name) === norm(name); })) {
      util.toast('Bu isimde bir oyuncu zaten var.', 'err');
      input.select();
      return;
    }
    store.state.players.push({ id: util.uid(), name: name });
    input.value = '';
    commitAndRender(store.patch.players());
    var again = util.el('newPlayerName');
    if (again) again.focus();
    util.toast(name + ' eklendi.', 'ok');
  }

  function renamePlayer(id) {
    var p = store.playerById(id);
    if (!p) return;
    util.prompt('Oyuncu adı', p.name, { title: 'Oyuncuyu Düzenle' }).then(function (val) {
      if (val == null) return;
      var name = val.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!name) { util.toast('İsim boş olamaz.', 'err'); return; }
      if (store.state.players.some(function (o) { return o.id !== id && norm(o.name) === norm(name); })) {
        util.toast('Bu isimde bir oyuncu zaten var.', 'err');
        return;
      }
      p.name = name;
      commitAndRender(store.patch.players());
    });
  }

  function deletePlayer(id) {
    var p = store.playerById(id);
    if (!p) return;
    var affected = store.state.matches.filter(function (m) { return m.p1 === id || m.p2 === id; }).length;
    var msg = affected ? p.name + ' silinecek ve bağlı ' + affected + ' maç da kaldırılacak.' : p.name + ' silinecek.';
    util.confirm(msg, { title: 'Oyuncuyu sil', okLabel: 'Sil', danger: true }).then(function (ok) {
      if (!ok) return;
      store.state.players = store.state.players.filter(function (x) { return x.id !== id; });
      store.state.matches = store.state.matches.filter(function (m) { return m.p1 !== id && m.p2 !== id; });
      if (!store.state.matches.some(function (m) { return m.phase === 'eleme'; })) store.state.playoffRound = 0;
      ui.closeSheet();
      commitAndRender({ players: store.state.players, matchesReplace: store.state.matches,
        playoffRound: store.state.playoffRound });
      util.toast('Oyuncu silindi.');
    });
  }

  /* ---------- fikstür ---------- */

  function genFixture() {
    if (store.state.players.length < 2) { util.toast('En az 2 oyuncu gerekli.', 'err'); return; }
    var played = store.state.matches.filter(function (m) { return m.phase === 'lig' && rules.hasScore(m); }).length;
    var go = function () {
      var n = schedule.generateFixture();
      store.commit(store.patch.allMatches());
      ui.render();
      util.toast(n + ' maç, ' + schedule.weekCount() + ' tura dağıtıldı.', 'ok');
    };
    if (played) {
      util.confirm('Girilmiş ' + played + ' maç skoru silinecek.',
        { title: 'Fikstürü yeniden oluştur', okLabel: 'Oluştur', danger: true })
        .then(function (ok) { if (ok) go(); });
    } else go();
  }

  function clearFixture() {
    util.confirm('Tüm lig maçları ve skorları silinecek.', { title: 'Fikstürü sil', okLabel: 'Sil', danger: true })
      .then(function (ok) {
        if (!ok) return;
        store.state.matches = store.state.matches.filter(function (m) { return m.phase !== 'lig'; });
        commitAndRender(store.patch.allMatches());
        util.toast('Fikstür silindi.');
      });
  }

  /* ---------- skor: set set, tek dokunuş, soru sormaz ---------- */

  /* "Ali maçı 2-1 kazandı." — skor her zaman kazananın lehine yazılır. */
  function winText(m, w, s) {
    return store.playerName(w === 'a' ? m.p1 : m.p2) + ' maçı ' +
      Math.max(s.a, s.b) + '-' + Math.min(s.a, s.b) + ' kazandı.';
  }

  function currentMatch() {
    if (!view.sheet || view.sheet.type !== 'match') return null;
    return store.matchById(view.sheet.id);
  }

  function addSet(a, b) {
    var m = currentMatch();
    if (!m) return;
    var c = store.settings;
    var err = rules.validateSet(a, b, c);
    if (err) { util.toast(err, 'err'); return; }
    var idx = rules.activeSetIndex(m, c);
    if (idx < 0) { util.toast('Maç zaten tamamlandı.', 'err'); return; }
    var overwrote = !!rules.openSet(m, c);
    m.sets[idx] = { a: a, b: b };   // devam eden yarım set varsa üzerine yazılır
    commitAndRender(store.patch.match(m));
    if (overwrote) util.toast('Yarım kalan set bu skorla değiştirildi.');
    var w = rules.matchWinner(m, c);
    if (w) {
      var s = rules.matchSetsWon(m, c);
      util.toast(winText(m, w, s), 'ok');
    } else {
      util.toast(store.playerName(a > b ? m.p1 : m.p2) + ' seti ' + a + '-' + b + ' aldı.', 'ok');
    }
  }

  /* Detaylı giriş: oyun oyun sayı. Set dolunca kendiliğinden kapanır. */
  function addGame(a, b) {
    var m = currentMatch();
    if (!m) return;
    var c = store.settings;
    var err = rules.validateGame(a, b, c);
    if (err) { util.toast(err, 'err'); return; }
    var idx = rules.activeSetIndex(m, c);
    if (idx < 0) { util.toast('Maç zaten tamamlandı.', 'err'); return; }

    var set = m.sets[idx];
    if (!set) { set = { a: 0, b: 0, games: [] }; m.sets[idx] = set; }
    if (!Array.isArray(set.games)) set.games = [];
    set.games.push({ a: a, b: b });
    var t = rules.tallyGames(set.games);
    set.a = t.a; set.b = t.b;

    commitAndRender(store.patch.match(m));

    var sw = rules.setWinner(set, c);
    var w = rules.matchWinner(m, c);
    if (w) {
      var ms = rules.matchSetsWon(m, c);
      util.toast(winText(m, w, ms), 'ok');
    } else if (sw) {
      util.toast((idx + 1) + '. seti ' + store.playerName(sw === 'a' ? m.p1 : m.p2) + ' aldı (' + set.a + '-' + set.b + ').', 'ok');
    }
  }

  function undoGame() {
    var m = currentMatch();
    if (!m) return;
    for (var i = m.sets.length - 1; i >= 0; i--) {
      var set = m.sets[i];
      if (!set.games || !set.games.length) continue;
      set.games.pop();
      var t = rules.tallyGames(set.games);
      set.a = t.a; set.b = t.b;
      if (!set.games.length) m.sets.splice(i, 1);
      commitAndRender(store.patch.match(m));
      return;
    }
    util.toast('Geri alınacak oyun yok.', 'err');
  }

  function setInputMode(mode) {
    store.prefs.inputMode = mode === 'detailed' ? 'detailed' : 'fast';
    store.savePrefs();
    ui.render();
  }

  function deleteSet(i) {
    var m = currentMatch();
    if (!m || !m.sets[i]) return;
    m.sets.splice(i, 1);
    commitAndRender(store.patch.match(m));
  }

  function clearScore() {
    var m = currentMatch();
    if (!m) return;
    m.sets = [];
    commitAndRender(store.patch.match(m));
    util.toast('Skor silindi.');
  }

  /* ---------- eleme ---------- */

  function startPlayoffs() {
    var run = function () {
      var res = playoffs.start();
      if (!res.ok) { util.toast(res.error, 'err'); return; }
      commitAndRender(store.patch.allMatches());
      util.toast(res.count + ' oyuncu, ' + res.bracket + ' kişilik brakete yerleşti.', 'ok');
    };
    if (store.state.matches.some(function (m) { return m.phase === 'eleme'; })) {
      util.confirm('Mevcut eleme maçları ve skorları silinip bracket yeniden kurulacak.',
        { title: 'Elemeleri sıfırla', okLabel: 'Sıfırla', danger: true }).then(function (ok) { if (ok) run(); });
      return;
    }
    if (!standings.leagueComplete() && standings.progress().total) {
      util.confirm('Lig maçlarının tamamı oynanmadı. Mevcut puan durumuna göre devam edilsin mi?',
        { title: 'Lig bitmedi', okLabel: 'Devam et' }).then(function (ok) { if (ok) run(); });
      return;
    }
    run();
  }

  function clearPlayoffs() {
    util.confirm('Tüm eleme maçları ve skorları silinecek.', { title: 'Elemeyi sil', okLabel: 'Sil', danger: true })
      .then(function (ok) {
        if (!ok) return;
        playoffs.clear();
        commitAndRender(store.patch.allMatches());
        util.toast('Eleme silindi.');
      });
  }

  function nextRound() {
    var res = playoffs.advance();
    if (!res.ok) { util.toast(res.error, 'err'); return; }
    commitAndRender(store.patch.allMatches());
    util.toast('Yeni tur oluşturuldu.', 'ok');
  }

  /* ---------- ayarlar / veri ---------- */

  function applySetting(key, raw, isCheckbox) {
    var c = store.settings;
    if (isCheckbox) c[key] = !!raw;
    else if (key === 'theme') c[key] = ['auto', 'light', 'dark'].indexOf(raw) >= 0 ? raw : 'auto';
    else if (key === 'playoffSize') c[key] = util.clampInt(raw, 2, 32, 8);
    else {
      var lim = {
        gamesToWinSet: [1, 5, 3],
        setsToWinMatch: [1, 5, 2],
        winPoints: [0, 10, 2],
        lossPoints: [0, 10, 0]
      }[key];
      if (!lim) return;
      c[key] = util.clampInt(raw, lim[0], lim[1], lim[2]);
    }
    commitAndRender(store.patch.setting(key, c[key]));
  }

  function exportData() {
    util.downloadFile('lig-yedek-' + new Date().toISOString().slice(0, 10) + '.json', store.exportJSON());
    util.toast('Yedek indirildi.', 'ok');
  }

  function importData() {
    util.pickFile('.json,application/json').then(function (text) {
      if (!text) return;
      return util.confirm('Mevcut tüm veriler yedektekilerle değiştirilecek.',
        { title: 'Yedekten yükle', okLabel: 'Yükle', danger: true }).then(function (ok) {
          if (!ok) return;
          try {
            store.importJSON(text);
            store.commit(store.patch.everything());
            ui.closeSheet();
            ui.render();
            util.toast('Yedek yüklendi.', 'ok');
          } catch (e) {
            util.toast('Yedek okunamadı: ' + e.message, 'err');
          }
        });
    });
  }

  function clearScores() {
    util.confirm('Tüm maçların skorları silinir; fikstür ve oyuncular kalır.',
      { title: 'Skorları temizle', okLabel: 'Temizle', danger: true }).then(function (ok) {
        if (!ok) return;
        store.state.matches.forEach(function (m) { m.sets = []; });
        commitAndRender(store.patch.allMatches());
        util.toast('Skorlar temizlendi.');
      });
  }

  function resetAll() {
    util.confirm('Oyuncular, fikstür, skorlar ve ayarlar dahil her şey silinecek. Geri alınamaz.',
      { title: 'Her şeyi sıfırla', okLabel: 'Sıfırla', danger: true }).then(function (ok) {
        if (!ok) return;
        store.resetAll();
        view.tab = 'oyuncular'; view.week = 'all'; view.status = 'all'; view.query = '';
        ui.closeSheet();
        store.commit(store.patch.everything());
        ui.render();
        util.toast('Sıfırlandı.');
      });
  }

  function cycleTheme() {
    var order = ['auto', 'light', 'dark'];
    store.prefs.theme = order[(order.indexOf(store.prefs.theme) + 1) % order.length];
    store.savePrefs();
    ui.render();
    util.toast('Tema: ' + { auto: 'Sistem', light: 'Açık', dark: 'Koyu' }[store.prefs.theme]);
  }

  /* ---------- turnuva / senkronizasyon ---------- */

  function syncError(e) {
    util.toast(e && e.message ? e.message : 'Bağlantı hatası.', 'err');
  }

  function askPin() {
    if (!L.sync || !L.sync.isConnected()) return;
    util.prompt('Turnuva PIN\'i', '', { title: 'Skor girmek için PIN', okLabel: 'Giriş' })
      .then(function (pin) {
        if (!pin) return;
        return L.sync.authenticate(pin).then(function () {
          ui.render();
          util.toast('Yazma izni açıldı.', 'ok');
        }, syncError);
      });
  }

  function syncCreate() {
    var name = (util.el('syncName') || {}).value || '';
    var pin = (util.el('syncPin') || {}).value || '';
    name = name.trim();
    if (!name) { util.toast('Turnuva adı gerekli.', 'err'); return; }
    if (pin.trim().length < 4) { util.toast('PIN en az 4 karakter olmalı.', 'err'); return; }
    // Kurulum ekranından geliniyorsa sabit ortak kodla kur.
    var code = L.sync.needsSetup() ? L.sync.defaultCode : null;
    L.sync.create(name, pin.trim(), code).then(function () {
      ui.render();
      util.toast('Ortak tablo kuruldu. Adresi açan herkes bu tabloyu görecek.', 'ok');
    }, syncError);
  }

  function syncJoin() {
    var code = ((util.el('syncCode') || {}).value || '').trim().toUpperCase();
    if (!code) { util.toast('Turnuva kodu gerekli.', 'err'); return; }
    util.confirm('Bu cihazdaki yerel veriler ' + code + ' turnuvasınınkilerle değiştirilecek.',
      { title: 'Turnuvaya katıl', okLabel: 'Katıl', danger: true }).then(function (ok) {
        if (!ok) return;
        return L.sync.join(code).then(function (res) {
          ui.render();
          util.toast(res.name + ' turnuvasına bağlanıldı.', 'ok');
        }, syncError);
      });
  }

  function syncPin() {
    var pin = ((util.el('syncPinIn') || {}).value || '').trim();
    if (!pin) { util.toast('PIN girin.', 'err'); return; }
    L.sync.authenticate(pin).then(function () {
      ui.render();
      util.toast('Yazma izni açıldı.', 'ok');
    }, syncError);
  }

  function syncSignOut() {
    L.sync.signOut();
    ui.render();
    util.toast('Yazma izni bırakıldı (salt okunur).');
  }

  function syncCopy() {
    var s = L.sync.state();
    // Ortak tabloda kod gerekmez; sade adres paylaşılır.
    var url = s.code === L.sync.defaultCode
      ? location.origin + location.pathname
      : L.sync.shareUrl();
    util.copyText(url).then(function (ok) {
      util.toast(ok ? 'Link kopyalandı.' : url, ok ? 'ok' : '');
    });
  }

  function syncRefresh() {
    L.sync.refresh().then(function () {
      ui.render();
      util.toast('Güncellendi.', 'ok');
    }, syncError);
  }

  function syncLeave() {
    util.confirm('Bu cihaz yerel moda döner. Turnuva sunucuda kalır, kodla tekrar bağlanabilirsin.',
      { title: 'Bağlantıyı kes', okLabel: 'Kes' }).then(function (ok) {
        if (!ok) return;
        L.sync.leave();
        ui.render();
        util.toast('Yerel moda dönüldü.');
      });
  }

  /* ---------- delegasyon ---------- */

  var ACTIONS = {
    'cycle-theme': cycleTheme,
    'add-player': addPlayer,
    'rename-player': function (el) { renamePlayer(el.dataset.id); },
    'del-player': function (el) { deletePlayer(el.dataset.id); },
    'open-player': function (el) { ui.openPlayer(el.dataset.id); },
    'gen-fixture': genFixture,
    'clear-fixture': clearFixture,
    'open-match': function (el) { ui.openMatch(el.dataset.id); },
    'close-sheet': function () { ui.closeSheet(); },
    'sheet-back': function () { ui.sheetBack(); },
    'add-set': function (el) { addSet(+el.dataset.a, +el.dataset.b); },
    'add-game': function (el) { addGame(+el.dataset.a, +el.dataset.b); },
    'undo-game': undoGame,
    'input-mode': function (el) { setInputMode(el.dataset.v); },
    'set-group': function (el) { view.group = el.dataset.v; ui.render(); },
    'del-set': function (el) { deleteSet(+el.dataset.i); },
    'clear-score': clearScore,
    'set-status': function (el) { view.status = el.dataset.v; ui.render(); },
    'start-playoffs': startPlayoffs,
    'clear-playoffs': clearPlayoffs,
    'next-round': nextRound,
    'export': exportData,
    'import': importData,
    'clear-scores': clearScores,
    'reset-all': resetAll,
    'open-sync': function () { ui.openSync(); },
    'sync-create': syncCreate,
    'sync-join': syncJoin,
    'sync-pin': syncPin,
    'sync-signout': syncSignOut,
    'sync-copy': syncCopy,
    'sync-refresh': syncRefresh,
    'sync-leave': syncLeave
  };

  /* Turnuvayı değiştiren eylemler — salt okunur modda PIN ister. */
  var WRITE_ACTIONS = {
    'add-player': 1, 'rename-player': 1, 'del-player': 1, 'gen-fixture': 1, 'clear-fixture': 1,
    'add-set': 1, 'add-game': 1, 'undo-game': 1, 'del-set': 1, 'clear-score': 1,
    'start-playoffs': 1, 'clear-playoffs': 1, 'next-round': 1,
    'import': 1, 'clear-scores': 1, 'reset-all': 1, 'setting': 1
  };

  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var tab = e.target.closest('.tab');
    if (tab && tab.dataset.tab) { view.tab = tab.dataset.tab; ui.render(); return; }
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var act = el.dataset.act;
    if (WRITE_ACTIONS[act] && !requireWrite()) { e.preventDefault(); return; }
    var fn = ACTIONS[act];
    if (fn) { e.preventDefault(); fn(el); }
  });

  document.addEventListener('change', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    if (el.dataset.act === 'setting') {
      if (!requireWrite()) { ui.render(); return; }
      applySetting(el.dataset.key, el.type === 'checkbox' ? el.checked : el.value, el.type === 'checkbox');
    } else if (el.dataset.act === 'filter-week') {
      view.week = el.value;
      ui.render();
    }
  });

  var queryTimer = null;
  document.addEventListener('input', function (e) {
    if (!e.target.dataset || e.target.dataset.act !== 'filter-query') return;
    view.query = e.target.value;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(function () {
      ui.render();
      var box = document.querySelector('[data-act="filter-query"]');
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
    }, 220);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'newPlayerName') {
      e.preventDefault();
      if (requireWrite()) addPlayer();
    }
    if (e.key === 'Enter' && e.target.id === 'syncPinIn') { e.preventDefault(); syncPin(); }
    if (e.key === 'Enter' && e.target.id === 'syncCode') { e.preventDefault(); syncJoin(); }
    if (e.key === 'Enter' && (e.target.id === 'syncName' || e.target.id === 'syncPin')) { e.preventDefault(); syncCreate(); }
    if (e.key === 'Escape' && !util.el('overlay').hidden && util.el('modal').hidden) {
      if (view.stack.length) ui.sheetBack(); else ui.closeSheet();
    }
  });

  util.el('overlay').addEventListener('click', function (e) {
    if (e.target.id === 'overlay') ui.closeSheet();
  });

  if (global.matchMedia) {
    var mq = global.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { if (store.prefs.theme === 'auto') ui.applyTheme(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }

  global.addEventListener('storage', function (e) {
    if (e.key === store.KEY && !(L.sync && L.sync.isConnected())) location.reload();
  });

  ui.render();

  /* Bulut turnuvası varsa bağlan; yoksa yerel modda kalınır. */
  if (L.sync) {
    L.sync.onChange(function () { ui.updateSyncChip(); if (view.sheet && view.sheet.type === 'sync') ui.renderSheet(); });
    L.sync.onRemoteState(function () { ui.render(); });
    L.sync.init().then(function () { ui.render(); });
  }
})(window);
