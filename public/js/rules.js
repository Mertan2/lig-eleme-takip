/* Skor kuralları.
 * Oyun : 5 sayıya oynanır — uygulamaya girilmez, sadece kaç oyun alındığı girilir.
 * Set  : gamesToWinSet oyunu ilk kazanan alır (varsayılan 3 -> 3-0 / 3-1 / 3-2).
 * Maç  : setsToWinMatch seti ilk kazanan alır (varsayılan 2 -> best of 3).
 *
 * match.sets = [{a,b}, ...]  sadece oynanmış setler, sırayla.
 */
(function (global) {
  'use strict';

  var store = global.LIG.store;

  function cfg() { return store.settings; }
  function pointsNeed(c) { return (c || cfg()).pointsPerGame; }
  function gamesNeed(c) { return (c || cfg()).gamesToWinSet; }
  function setsNeed(c) { return (c || cfg()).setsToWinMatch; }
  function maxSets(c) { return setsNeed(c) * 2 - 1; }
  function maxGames(c) { return gamesNeed(c) * 2 - 1; }

  function isBye(m) { return m.p2 == null; }
  function sets(m) { return Array.isArray(m.sets) ? m.sets : []; }
  function hasScore(m) { return sets(m).length > 0; }

  function setWinner(set, c) {
    var g = gamesNeed(c);
    if (!set) return null;
    if (set.a >= g && set.a > set.b) return 'a';
    if (set.b >= g && set.b > set.a) return 'b';
    return null;
  }

  function matchSetsWon(m, c) {
    if (isBye(m)) return { a: setsNeed(c), b: 0 };
    var need = setsNeed(c), a = 0, b = 0, list = sets(m);
    for (var i = 0; i < list.length; i++) {
      if (a >= need || b >= need) break;
      var w = setWinner(list[i], c);
      if (w === 'a') a++; else if (w === 'b') b++;
    }
    return { a: a, b: b };
  }

  function matchGames(m, c) {
    if (isBye(m)) return { a: 0, b: 0 };
    var need = setsNeed(c), sa = 0, sb = 0, ga = 0, gb = 0, list = sets(m);
    for (var i = 0; i < list.length; i++) {
      if (sa >= need || sb >= need) break;
      ga += list[i].a; gb += list[i].b;
      var w = setWinner(list[i], c);
      if (w === 'a') sa++; else if (w === 'b') sb++;
    }
    return { a: ga, b: gb };
  }

  function matchWinner(m, c) {
    if (isBye(m)) return 'a';
    var need = setsNeed(c);
    var s = matchSetsWon(m, c);
    if (s.a >= need) return 'a';
    if (s.b >= need) return 'b';
    return null;
  }

  function matchWinnerId(m, c) {
    var w = matchWinner(m, c);
    return w ? (w === 'a' ? m.p1 : m.p2) : null;
  }

  function matchLoserId(m, c) {
    var w = matchWinner(m, c);
    return w ? (w === 'a' ? m.p2 : m.p1) : null;
  }

  /* Sıradaki (ya da devam eden) setin indeksi; maç bittiyse -1. */
  function activeSetIndex(m, c) {
    if (isBye(m) || matchWinner(m, c)) return -1;
    var list = sets(m);
    if (list.length && setWinner(list[list.length - 1], c) === null) return list.length - 1;
    return list.length < maxSets(c) ? list.length : -1;
  }

  /* Devam eden (bitmemiş) set varsa döner. */
  function openSet(m, c) {
    var list = sets(m);
    if (!list.length) return null;
    var last = list[list.length - 1];
    return setWinner(last, c) === null ? last : null;
  }

  /* Bir oyun skoru geçerli mi? Hata metni ya da null. */
  function validateGame(a, b, c) {
    var p = pointsNeed(c);
    if (!isFinite(a) || !isFinite(b) || a % 1 || b % 1 || a < 0 || b < 0) return 'Geçerli iki sayı girin.';
    if (a === b) return 'Oyun berabere bitemez.';
    var w = Math.max(a, b), l = Math.min(a, b);
    if (w !== p) return 'Oyunu kazanan tam ' + p + ' sayı almalı.';
    if (l >= p) return 'Kaybeden en fazla ' + (p - 1) + ' sayı alabilir.';
    return null;
  }

  /* [[5,0],[5,1],...,[5,4]] */
  function winningGameScores(c) {
    var p = pointsNeed(c), out = [];
    for (var l = 0; l < p; l++) out.push([p, l]);
    return out;
  }

  /* Bir setin oyun listesinden {a,b} oyun sayısını hesaplar. */
  function tallyGames(games) {
    var a = 0, b = 0;
    for (var i = 0; i < (games || []).length; i++) {
      if (games[i].a > games[i].b) a++; else if (games[i].b > games[i].a) b++;
    }
    return { a: a, b: b };
  }

  /* "5-3, 2-5, 5-1" */
  function gameDetail(set) {
    if (!set || !Array.isArray(set.games) || !set.games.length) return '';
    return set.games.map(function (g) { return g.a + '-' + g.b; }).join(', ');
  }

  /* Bir set skoru geçerli mi? Hata metni ya da null. */
  function validateSet(a, b, c) {
    var g = gamesNeed(c);
    if (!isFinite(a) || !isFinite(b) || a % 1 || b % 1 || a < 0 || b < 0) return 'Geçerli iki oyun sayısı girin.';
    if (a === b) return 'Set berabere bitemez.';
    var w = Math.max(a, b), l = Math.min(a, b);
    if (w !== g) return 'Seti kazanan tam ' + g + ' oyun almalı.';
    if (l >= g) return 'Kaybeden en fazla ' + (g - 1) + ' oyun alabilir.';
    return null;
  }

  /* [[3,0],[3,1],[3,2]] — kazananın solda olduğu tüm set skorları. */
  function winningSetScores(c) {
    var g = gamesNeed(c), out = [];
    for (var l = 0; l < g; l++) out.push([g, l]);
    return out;
  }

  /* "3-1, 2-3, 3-0" */
  function setDetail(m, c) {
    var need = setsNeed(c), a = 0, b = 0, parts = [], list = sets(m);
    for (var i = 0; i < list.length; i++) {
      if (a >= need || b >= need) break;
      parts.push(list[i].a + '-' + list[i].b);
      var w = setWinner(list[i], c);
      if (w === 'a') a++; else if (w === 'b') b++;
    }
    return parts.join(', ');
  }

  global.LIG.rules = {
    cfg: cfg,
    pointsNeed: pointsNeed,
    gamesNeed: gamesNeed,
    setsNeed: setsNeed,
    maxSets: maxSets,
    maxGames: maxGames,
    isBye: isBye,
    sets: sets,
    hasScore: hasScore,
    setWinner: setWinner,
    matchSetsWon: matchSetsWon,
    matchGames: matchGames,
    matchWinner: matchWinner,
    matchWinnerId: matchWinnerId,
    matchLoserId: matchLoserId,
    activeSetIndex: activeSetIndex,
    openSet: openSet,
    validateSet: validateSet,
    validateGame: validateGame,
    winningSetScores: winningSetScores,
    winningGameScores: winningGameScores,
    tallyGames: tallyGames,
    gameDetail: gameDetail,
    setDetail: setDetail
  };
})(window);
