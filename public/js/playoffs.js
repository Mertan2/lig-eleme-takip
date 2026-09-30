/* Eleme braketi: standart seri başı eşleşmesi (1-8, 4-5, 2-7, 3-6) ve eksik seri başı yerine BAY. */
(function (global) {
  'use strict';

  var store = global.LIG.store;
  var rules = global.LIG.rules;
  var standings = global.LIG.standings;

  function nextPow2(n) {
    var p = 1;
    while (p < n) p *= 2;
    return Math.max(2, p);
  }

  /* [1,8,4,5,2,7,3,6] gibi seri başı sırası üretir. */
  function seedOrder(size) {
    var arr = [1, 2];
    while (arr.length < size) {
      var total = arr.length * 2;
      var next = [];
      for (var i = 0; i < arr.length; i++) {
        next.push(arr[i]);
        next.push(total + 1 - arr[i]);
      }
      arr = next;
    }
    return arr;
  }

  function roundName(bracketSize) {
    if (bracketSize === 2) return 'Final';
    if (bracketSize === 4) return 'Yarı Final';
    if (bracketSize === 8) return 'Çeyrek Final';
    return 'Son ' + bracketSize;
  }

  function roundMatches(round) {
    return store.state.matches
      .filter(function (m) { return m.phase === 'eleme' && m.round === round; })
      .sort(function (a, b) { return a.order - b.order; });
  }

  function rounds() {
    var seen = {};
    store.state.matches.forEach(function (m) { if (m.phase === 'eleme') seen[m.round] = true; });
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function start() {
    var ids = standings.qualifiers();
    if (ids.length < 2) return { ok: false, error: 'Eleme için en az 2 oyuncu gerekli.' };

    var K = ids.length;
    var size = nextPow2(K);
    var order = seedOrder(size);

    store.state.matches = store.state.matches.filter(function (m) { return m.phase !== 'eleme'; });
    store.state.playoffRound = 1;

    for (var i = 0; i < size / 2; i++) {
      var s1 = order[2 * i], s2 = order[2 * i + 1];
      var p1 = s1 <= K ? ids[s1 - 1] : null;
      var p2 = s2 <= K ? ids[s2 - 1] : null;
      if (p1 == null && p2 == null) continue;
      if (p1 == null) { p1 = p2; p2 = null; }   // BAY her zaman ikinci taraf
      store.state.matches.push(store.newMatch('eleme', p1, p2, 1, i));
    }
    store.save();
    return { ok: true, count: K, bracket: size };
  }

  function currentRound() {
    var rs = rounds();
    return rs.length ? rs[rs.length - 1] : 0;
  }

  function roundDecided(round) {
    var ms = roundMatches(round);
    return ms.length > 0 && ms.every(function (m) { return rules.matchWinner(m); });
  }

  function advance() {
    var round = currentRound();
    if (!round) return { ok: false, error: 'Önce elemeleri başlatın.' };
    var ms = roundMatches(round);
    if (!roundDecided(round)) return { ok: false, error: 'Bu turdaki tüm maçlar bitmeden sonraki tur oluşturulamaz.' };
    if (ms.length <= 1) return { ok: false, error: 'Turnuva zaten tamamlandı.' };

    var winners = ms.map(function (m) { return rules.matchWinnerId(m); });
    var next = round + 1;
    for (var i = 0; i < winners.length; i += 2) {
      var p1 = winners[i];
      var p2 = i + 1 < winners.length ? winners[i + 1] : null;
      store.state.matches.push(store.newMatch('eleme', p1, p2, next, i / 2));
    }
    store.state.playoffRound = next;
    store.save();
    return { ok: true, round: next };
  }

  function champion() {
    var round = currentRound();
    if (!round) return null;
    var ms = roundMatches(round);
    if (ms.length !== 1) return null;
    return rules.matchWinnerId(ms[0]);
  }

  function runnerUp() {
    var round = currentRound();
    if (!round) return null;
    var ms = roundMatches(round);
    if (ms.length !== 1 || !rules.matchWinner(ms[0])) return null;
    return rules.matchLoserId(ms[0]);
  }

  function clear() {
    store.state.matches = store.state.matches.filter(function (m) { return m.phase !== 'eleme'; });
    store.state.playoffRound = 0;
    store.save();
  }

  global.LIG.playoffs = {
    seedOrder: seedOrder,
    roundName: roundName,
    rounds: rounds,
    roundMatches: roundMatches,
    currentRound: currentRound,
    roundDecided: roundDecided,
    start: start,
    advance: advance,
    champion: champion,
    runnerUp: runnerUp,
    clear: clear
  };
})(window);
