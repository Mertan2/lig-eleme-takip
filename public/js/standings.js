/* Puan durumu ve oyuncu istatistikleri.
 * Sıralama: puan > ikili averaj (head-to-head) > set averajı > oyun averajı > isim.
 */
(function (global) {
  'use strict';

  var store = global.LIG.store;
  var rules = global.LIG.rules;

  function blankRow(id, name) {
    return { id: id, name: name, oyn: 0, gal: 0, mag: 0, puan: 0, setG: 0, setK: 0, oyunG: 0, oyunK: 0 };
  }

  function addResult(row, s, g, won, c) {
    row.oyn++;
    row.setG += s.mine; row.setK += s.theirs;
    row.oyunG += g.mine; row.oyunK += g.theirs;
    if (won) { row.gal++; row.puan += c.winPoints; }
    else { row.mag++; row.puan += c.lossPoints; }
  }

  function sides(m, c) {
    var s = rules.matchSetsWon(m, c);
    var g = rules.matchGames(m, c);
    return {
      p1: { sets: { mine: s.a, theirs: s.b }, games: { mine: g.a, theirs: g.b } },
      p2: { sets: { mine: s.b, theirs: s.a }, games: { mine: g.b, theirs: g.a } }
    };
  }

  function leagueResults() {
    return store.state.matches.filter(function (m) {
      return m.phase === 'lig' && !rules.isBye(m) && rules.matchWinner(m);
    });
  }

  function miniTable(ids) {
    var c = store.settings;
    var inSet = {};
    ids.forEach(function (id) { inSet[id] = true; });
    var rows = {};
    ids.forEach(function (id) { rows[id] = blankRow(id, store.playerName(id)); });
    leagueResults().forEach(function (m) {
      if (!inSet[m.p1] || !inSet[m.p2]) return;
      var v = sides(m, c), w = rules.matchWinner(m, c);
      addResult(rows[m.p1], v.p1.sets, v.p1.games, w === 'a', c);
      addResult(rows[m.p2], v.p2.sets, v.p2.games, w === 'b', c);
    });
    return rows;
  }

  function setAv(r) { return r.setG - r.setK; }
  function gameAv(r) { return r.oyunG - r.oyunK; }

  function compute() {
    var c = store.settings;
    var rows = {};
    store.state.players.forEach(function (p) { rows[p.id] = blankRow(p.id, p.name); });

    leagueResults().forEach(function (m) {
      if (!rows[m.p1] || !rows[m.p2]) return;
      var v = sides(m, c), w = rules.matchWinner(m, c);
      addResult(rows[m.p1], v.p1.sets, v.p1.games, w === 'a', c);
      addResult(rows[m.p2], v.p2.sets, v.p2.games, w === 'b', c);
    });

    var list = Object.keys(rows).map(function (k) { return rows[k]; });
    list.sort(function (x, y) { return y.puan - x.puan || x.name.localeCompare(y.name, 'tr'); });

    var out = [], i = 0;
    while (i < list.length) {
      var j = i;
      while (j + 1 < list.length && list[j + 1].puan === list[i].puan) j++;
      var group = list.slice(i, j + 1);
      if (group.length > 1) {
        var mini = miniTable(group.map(function (r) { return r.id; }));
        group.sort(function (x, y) {
          var mx = mini[x.id], my = mini[y.id];
          return (my.puan - mx.puan)
            || (setAv(my) - setAv(mx))
            || (gameAv(my) - gameAv(mx))
            || (setAv(y) - setAv(x))
            || (gameAv(y) - gameAv(x))
            || x.name.localeCompare(y.name, 'tr');
        });
      }
      out = out.concat(group);
      i = j + 1;
    }

    out.forEach(function (r, idx) { r.sira = idx + 1; });
    return out;
  }

  function qualifiers() {
    var list = compute();
    return list.slice(0, Math.min(store.settings.playoffSize, list.length)).map(function (r) { return r.id; });
  }

  function leagueComplete() {
    var lig = store.state.matches.filter(function (m) { return m.phase === 'lig'; });
    return lig.length > 0 && lig.every(function (m) { return rules.matchWinner(m); });
  }

  function progress() {
    var lig = store.state.matches.filter(function (m) { return m.phase === 'lig'; });
    var done = lig.filter(function (m) { return rules.matchWinner(m); }).length;
    return { done: done, total: lig.length, pct: lig.length ? Math.round(done / lig.length * 100) : 0 };
  }

  function playerMatches(id) {
    return store.state.matches
      .filter(function (m) { return m.p1 === id || m.p2 === id; })
      .sort(function (x, y) {
        if (x.phase !== y.phase) return x.phase === 'lig' ? -1 : 1;
        return x.round - y.round || x.order - y.order;
      });
  }

  function playerStats(id) {
    var c = store.settings;
    var table = compute();
    var row = null;
    for (var i = 0; i < table.length; i++) if (table[i].id === id) row = table[i];
    if (!row) return null;

    var history = [], opponents = {}, form = [];
    var curWin = 0, curLoss = 0, bestStreak = 0;
    var elemeOyn = 0, elemeGal = 0;
    var best = null, worst = null;

    playerMatches(id).forEach(function (m) {
      var meFirst = m.p1 === id;
      var oppId = meFirst ? m.p2 : m.p1;
      var bye = rules.isBye(m);
      var w = rules.matchWinner(m, c);
      var s = rules.matchSetsWon(m, c);
      var g = rules.matchGames(m, c);
      var mine = meFirst ? s.a : s.b, theirs = meFirst ? s.b : s.a;
      var gm = meFirst ? g.a : g.b, gt = meFirst ? g.b : g.a;
      var won = bye ? true : (w ? (meFirst ? w === 'a' : w === 'b') : null);

      history.push({
        id: m.id, phase: m.phase, round: m.round, bye: bye,
        oppId: oppId, oppName: bye ? 'BAY' : store.playerName(oppId),
        played: !!w, won: won, mine: mine, theirs: theirs,
        detail: bye ? '' : rules.setDetail(m, c)
      });

      if (!w || bye) return;

      if (m.phase === 'eleme') { elemeOyn++; if (won) elemeGal++; }
      form.push(won);
      if (won) { curWin++; curLoss = 0; if (curWin > bestStreak) bestStreak = curWin; }
      else { curLoss++; curWin = 0; }

      var d = mine - theirs;
      if (won && (!best || d > best.diff || (d === best.diff && gm - gt > best.gd))) {
        best = { diff: d, gd: gm - gt, oppName: store.playerName(oppId), text: mine + '-' + theirs };
      }
      if (!won && (!worst || d < worst.diff || (d === worst.diff && gm - gt < worst.gd))) {
        worst = { diff: d, gd: gm - gt, oppName: store.playerName(oppId), text: mine + '-' + theirs };
      }

      if (oppId != null) {
        var o = opponents[oppId] || (opponents[oppId] = {
          id: oppId, name: store.playerName(oppId), oyn: 0, gal: 0, mag: 0, setG: 0, setK: 0, oyunG: 0, oyunK: 0
        });
        o.oyn++; o.setG += mine; o.setK += theirs; o.oyunG += gm; o.oyunK += gt;
        if (won) o.gal++; else o.mag++;
      }
    });

    var oppList = Object.keys(opponents).map(function (k) { return opponents[k]; })
      .sort(function (a, b) { return (b.gal - b.mag) - (a.gal - a.mag) || a.name.localeCompare(b.name, 'tr'); });

    return {
      row: row,
      total: table.length,
      history: history,
      opponents: oppList,
      form: form.slice(-5),
      streak: curWin,
      lossStreak: curLoss,
      bestStreak: bestStreak,
      winPct: row.oyn ? Math.round(row.gal / row.oyn * 100) : 0,
      setPct: (row.setG + row.setK) ? Math.round(row.setG / (row.setG + row.setK) * 100) : 0,
      gamePct: (row.oyunG + row.oyunK) ? Math.round(row.oyunG / (row.oyunG + row.oyunK) * 100) : 0,
      eleme: { oyn: elemeOyn, gal: elemeGal },
      best: best,
      worst: worst,
      remaining: history.filter(function (h) { return !h.played && !h.bye; }).length
    };
  }

  global.LIG.standings = {
    compute: compute,
    qualifiers: qualifiers,
    leagueComplete: leagueComplete,
    progress: progress,
    playerMatches: playerMatches,
    playerStats: playerStats
  };
})(window);
