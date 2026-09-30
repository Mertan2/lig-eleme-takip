/* Lig fikstürü: dairesel (Berger) yöntemle turlara bölünmüş tam round-robin. */
(function (global) {
  'use strict';

  var store = global.LIG.store;

  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ids -> [[ [a,b], [c,d] ], ...] her eleman bir tur. */
  function roundRobin(ids, doubleRound) {
    var list = ids.slice();
    if (list.length % 2 === 1) list.push(null); // tek sayıda oyuncu -> bay
    var n = list.length;
    var rounds = [];
    if (n < 2) return rounds;

    var arr = list.slice();
    for (var r = 0; r < n - 1; r++) {
      var pairs = [];
      for (var i = 0; i < n / 2; i++) {
        var a = arr[i], b = arr[n - 1 - i];
        if (a == null || b == null) continue;      // bay geçen oyuncu
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]); // ev/deplasman dengesi
      }
      rounds.push(pairs);
      arr = [arr[0]].concat([arr[n - 1]], arr.slice(1, n - 1));
    }

    if (doubleRound) {
      var second = rounds.map(function (week) {
        return week.map(function (p) { return [p[1], p[0]]; });
      });
      rounds = rounds.concat(second);
    }
    return rounds;
  }

  /* Lig maçlarını üretir ve state'e yazar. */
  function generateFixture(opts) {
    opts = opts || {};
    var s = store.state;
    var ids = s.players.map(function (p) { return p.id; });
    if (opts.randomize) ids = shuffled(ids);

    var weeks = roundRobin(ids, s.settings.doubleRound);
    var matches = [];
    weeks.forEach(function (week, wi) {
      week.forEach(function (pair, mi) {
        matches.push(store.newMatch('lig', pair[0], pair[1], wi + 1, mi));
      });
    });

    s.matches = s.matches.filter(function (m) { return m.phase !== 'lig'; }).concat(matches);
    store.save();
    return matches.length;
  }

  function weekCount() {
    var weeks = {};
    store.state.matches.forEach(function (m) { if (m.phase === 'lig') weeks[m.round] = true; });
    return Object.keys(weeks).length;
  }

  global.LIG.schedule = {
    roundRobin: roundRobin,
    generateFixture: generateFixture,
    weekCount: weekCount
  };
})(window);
