/* Görünüm katmanı: sekmeler, kartlar, skor ve oyuncu sayfaları. */
(function (global) {
  'use strict';

  var L = global.LIG;
  var util = L.util, store = L.store, rules = L.rules;
  var standings = L.standings, playoffs = L.playoffs;
  var esc = util.esc;

  var view = {
    tab: 'oyuncular',
    status: 'all',
    query: '',
    sheet: null,      // {type:'match'|'player', id}
    stack: []         // geri dönüş yığını
  };

  /* ---------- küçük parçalar ---------- */

  function initials(name) {
    var parts = String(name).trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toLocaleUpperCase('tr'); }).join('') || '?';
  }

  function hue(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return h;
  }

  function avatar(name, size) {
    return '<span class="avatar' + (size === 'lg' ? ' avatar--lg' : '') + '" ' +
      'style="--h:' + hue(String(name)) + '">' + esc(initials(name)) + '</span>';
  }

  function phaseLabel(m) {
    if (m.phase === 'lig') return m.round + '. Tur';
    return playoffs.roundName(playoffs.roundMatches(m.round).length * 2);
  }

  function matchCard(m, opts) {
    opts = opts || {};
    var c = store.settings;
    var w = rules.matchWinner(m, c);
    var bye = rules.isBye(m);
    var s = rules.matchSetsWon(m, c);
    var scored = rules.hasScore(m);

    var badge = bye ? '<span class="badge bye">BAY</span>'
      : w ? '<span class="badge done">Tamamlandı</span>'
        : '<span class="badge">Bekliyor</span>';

    if (opts.compact) {
      return '<button class="match match--compact" data-act="open-match" data-id="' + esc(m.id) + '"' +
        (bye ? ' disabled' : '') + '>' +
        compactRow(store.playerName(m.p1), bye ? '—' : (scored ? String(s.a) : ''), w === 'a') +
        (bye
          ? '<span class="cm-row dim"><span class="nm">BAY</span><span class="sc"></span></span>'
          : compactRow(store.playerName(m.p2), scored ? String(s.b) : '', w === 'b')) +
        '</button>';
    }

    return '<button class="match' + (w ? ' match--done' : '') + '" data-act="open-match" data-id="' + esc(m.id) + '"' +
      (bye ? ' disabled' : '') + '>' +
      '<div class="match-row">' +
      '<span class="match-side' + (w === 'a' ? ' win' : '') + '">' +
      avatar(store.playerName(m.p1)) + '<span class="nm">' + esc(store.playerName(m.p1)) + '</span></span>' +
      '<span class="match-score">' + (bye ? '—' : (scored ? s.a + '<i>:</i>' + s.b : '<i>vs</i>')) + '</span>' +
      '<span class="match-side right' + (w === 'b' ? ' win' : '') + '">' +
      '<span class="nm">' + esc(bye ? 'BAY' : store.playerName(m.p2)) + '</span>' + (bye ? '' : avatar(store.playerName(m.p2))) + '</span>' +
      '</div>' +
      (scored && !bye ? '<div class="match-detail">' + esc(rules.setDetail(m, c)) + '</div>' : '') +
      (opts.hideMeta ? '' : '<div class="match-meta">' + badge + '<span>' + esc(phaseLabel(m)) + '</span></div>') +
      '</button>';
  }

  function compactRow(name, score, won) {
    return '<span class="cm-row' + (won ? ' win' : '') + '">' + avatar(name) +
      '<span class="nm">' + esc(name) + '</span><span class="sc">' + esc(score) + '</span></span>';
  }

  function statTile(k, v, sub) {
    return '<div class="stat"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div>' +
      (sub ? '<div class="s">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function progressBar(pct) {
    return '<div class="progress"><span style="width:' + pct + '%"></span></div>';
  }

  /* ---------- Oyuncular ---------- */

  function renderPlayers() {
    var s = store.state;
    var pr = standings.progress();
    var table = standings.compute();
    var rank = {};
    table.forEach(function (r) { rank[r.id] = r; });

    var html = '';

    if (s.players.length) {
      html += '<div class="card">' +
        '<div class="stat-grid">' +
        statTile('Oyuncu', s.players.length) +
        statTile('Lig maçı', pr.total) +
        statTile('Oynanan', pr.done + '<small>/' + pr.total + '</small>') +
        '</div>' +
        (pr.total ? '<div style="margin-top:12px;">' + progressBar(pr.pct) +
          '<div class="hint" style="margin-top:6px;">Lig %' + pr.pct + ' tamamlandı.</div></div>' : '') +
        '</div>';
    }

    if (canEdit()) {
      html += '<div class="card">' +
        '<div class="row">' +
        '<input type="text" id="newPlayerName" class="grow" placeholder="Oyuncu adı ekle…" maxlength="40" autocomplete="off" enterkeyhint="done">' +
        '<button data-act="add-player">Ekle</button>' +
        '</div></div>';
    } else {
      html += lockedHint('Oyuncu eklemek, fikstür oluşturmak ve skor girmek için şifre gerekir.');
    }

    if (!s.players.length) {
      html += '<div class="empty">Henüz oyuncu yok.<br>Yukarıdan ekleyerek başlayın.</div>';
    } else {
      html += '<div class="card card--list">';
      s.players.forEach(function (p) {
        var r = rank[p.id] || { sira: '-', gal: 0, mag: 0, puan: 0, oyn: 0 };
        html += '<button class="prow" data-act="open-player" data-id="' + esc(p.id) + '">' +
          avatar(p.name) +
          '<span class="prow-main">' +
          '<span class="prow-name">' + esc(p.name) + '</span>' +
          '<span class="prow-sub">' + (r.oyn ? r.gal + 'G · ' + r.mag + 'M · ' + r.puan + ' puan' : 'Maç oynamadı') + '</span>' +
          '</span>' +
          '<span class="prow-rank">' + (r.oyn ? r.sira + '.' : '–') + '</span>' +
          '<span class="prow-arrow">›</span>' +
          '</button>';
      });
      html += '</div>';
    }

    var ligCount = s.matches.filter(function (m) { return m.phase === 'lig'; }).length;
    if (canEdit()) {
      html += '<div class="card">' +
        '<button class="block" data-act="gen-fixture"' + (s.players.length < 2 ? ' disabled' : '') + '>' +
        (ligCount ? 'Fikstürü Yeniden Oluştur' : 'Fikstürü Oluştur') + '</button>' +
        '<div class="hint">' +
        (s.settings.doubleRound ? 'Çift devreli: herkes birbiriyle 2 kez oynar.' : 'Tek devreli: herkes birbiriyle 1 kez oynar.') +
        ' Maçlar turlara dağıtılır.' + (ligCount ? ' <strong>Yeniden oluşturmak girilmiş skorları siler.</strong>' : '') +
        '</div>' +
        (ligCount ? '<button class="ghost block" data-act="clear-fixture" style="margin-top:10px;">Fikstürü Sil</button>' : '') +
        '</div>';
    }

    return html;
  }

  /* ---------- Fikstür ---------- */

  function renderFixture() {
    var all = store.state.matches.filter(function (m) { return m.phase === 'lig'; });
    if (!all.length) return '<div class="empty">Henüz fikstür yok.<br>Oyuncular sekmesinden oluşturun.</div>';

    var pr = standings.progress();

    var segs = [['all', 'Tümü'], ['pending', 'Bekleyen'], ['played', 'Oynanan']].map(function (o) {
      return '<button class="seg' + (view.status === o[0] ? ' on' : '') + '" data-act="set-status" data-v="' + o[0] + '">' + o[1] + '</button>';
    }).join('');

    var html = '<div class="card">' +
      '<div class="seg-group">' + segs + '</div>' +
      '<div class="row" style="margin-top:10px;">' +
      '<input type="search" class="grow" data-act="filter-query" placeholder="Oyuncu ara…" value="' + esc(view.query) + '">' +
      '</div>' +
      '<div style="margin-top:12px;">' + progressBar(pr.pct) +
      '<div class="hint" style="margin-top:6px;">' + pr.done + ' / ' + pr.total + ' maç oynandı.</div></div>' +
      '</div>';

    var q = view.query.trim().toLocaleLowerCase('tr');

    var list = all.filter(function (m) {
      var played = !!rules.matchWinner(m);
      if (view.status === 'pending' && played) return false;
      if (view.status === 'played' && !played) return false;
      return true;
    });

    return html + renderFixtureByPlayer(list, q);
  }

  /* Her oyuncunun adı altında kendi maçları. */
  function renderFixtureByPlayer(list, q) {
    var c = store.settings;
    var players = store.state.players.filter(function (p) {
      return !q || p.name.toLocaleLowerCase('tr').indexOf(q) >= 0;
    });
    if (!players.length) return '<div class="empty">Bu isimde oyuncu yok.</div>';

    var html = '';
    var any = false;

    players.forEach(function (p) {
      var mine = list.filter(function (m) { return m.p1 === p.id || m.p2 === p.id; })
        .sort(function (x, y) { return x.round - y.round || x.order - y.order; });
      if (!mine.length) return;
      any = true;

      var played = 0, won = 0;
      mine.forEach(function (m) {
        var w = rules.matchWinner(m, c);
        if (!w) return;
        played++;
        if ((m.p1 === p.id && w === 'a') || (m.p2 === p.id && w === 'b')) won++;
      });

      html += '<div class="pgroup">' +
        '<button class="pgroup-head" data-act="open-player" data-id="' + esc(p.id) + '">' +
        avatar(p.name) +
        '<span class="pg-name">' + esc(p.name) + '</span>' +
        '<span class="pg-sub">' + mine.length + ' maç · ' + played + ' oynandı' + (played ? ' · ' + won + 'G' : '') + '</span>' +
        '<span class="prow-arrow">›</span>' +
        '</button>' +
        '<div class="hist">' + mine.map(function (m) {
          var meFirst = m.p1 === p.id;
          var oppId = meFirst ? m.p2 : m.p1;
          var bye = rules.isBye(m);
          var w = rules.matchWinner(m, c);
          var s = rules.matchSetsWon(m, c);
          var started = !bye && rules.hasScore(m);
          var mineScore = meFirst ? s.a : s.b, theirs = meFirst ? s.b : s.a;
          var won2 = bye ? true : (w ? (meFirst ? w === 'a' : w === 'b') : null);
          var tag = bye ? '<span class="hb bye">BAY</span>'
            : w ? (won2 ? '<span class="hb w">G</span>' : '<span class="hb l">M</span>')
              : started ? '<span class="hb live">•</span>'
                : '<span class="hb">—</span>';
          return '<button class="hrow" data-act="open-match" data-id="' + esc(m.id) + '"' + (bye ? ' disabled' : '') + '>' +
            tag +
            '<span class="hr-opp">' + esc(bye ? 'BAY' : store.playerName(oppId)) +
            (started ? '<small class="hr-detail">' + esc(rules.setDetail(m, c)) +
              (w ? '' : ' · devam ediyor') + '</small>' : '') + '</span>' +
            '<span class="hr-meta">' + m.round + '. Tur</span>' +
            '<span class="hr-score' + (!w && started ? ' live' : '') + '">' +
            (bye ? '—' : (w || started) ? mineScore + '-' + theirs : '') + '</span>' +
            '</button>';
        }).join('') + '</div></div>';
    });

    return any ? html : '<div class="empty">Bu filtreye uyan maç yok.</div>';
  }

  /* ---------- Puan Durumu ---------- */

  function renderStandings() {
    var rows = standings.compute();
    if (!rows.length) return '<div class="empty">Önce oyuncu ekleyin.</div>';

    var cut = Math.min(store.settings.playoffSize, rows.length);
    var markCut = cut < rows.length;

    var html = '<div class="card card--tight"><div class="table-wrap"><table>' +
      '<thead><tr><th>#</th><th>Oyuncu</th><th title="Oynanan">O</th><th title="Galibiyet">G</th>' +
      '<th title="Mağlubiyet">M</th><th title="Puan">P</th><th title="Alınan-verilen set">Set</th>' +
      '<th title="Set averajı">Av</th><th title="Alınan-verilen oyun">Oyun</th></tr></thead><tbody>';

    rows.forEach(function (r, i) {
      var av = r.setG - r.setK;
      html += '<tr class="' + (markCut && i < cut ? 'qualified' : '') + '" data-act="open-player" data-id="' + esc(r.id) + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="nmcell">' + avatar(r.name) + '<span>' + esc(r.name) + '</span></td>' +
        '<td>' + r.oyn + '</td><td>' + r.gal + '</td><td>' + r.mag + '</td>' +
        '<td class="pts">' + r.puan + '</td>' +
        '<td>' + r.setG + '-' + r.setK + '</td>' +
        '<td class="' + (av > 0 ? 'pos' : av < 0 ? 'neg' : '') + '">' + (av > 0 ? '+' : '') + av + '</td>' +
        '<td>' + r.oyunG + '-' + r.oyunK + '</td></tr>';
    });

    html += '</tbody></table></div></div>' +
      '<div class="hint" style="padding:0 4px;">' +
      (markCut ? 'İlk <strong>' + cut + '</strong> oyuncu elemeye çıkar. ' : '') +
      'Eşitlikte sırasıyla ikili averaj, set averajı ve oyun averajı belirleyici. Detay için oyuncuya dokunun.</div>';
    return html;
  }

  /* ---------- Eleme ---------- */

  function renderPlayoffs() {
    var rs = playoffs.rounds();
    var started = rs.length > 0;
    var qCount = Math.min(store.settings.playoffSize, store.state.players.length);

    var html = !canEdit() ? '' : '<div class="card">' +
      '<button class="block' + (started ? ' secondary' : '') + '" data-act="start-playoffs"' +
      (store.state.players.length < 2 ? ' disabled' : '') + '>' +
      (started ? 'Elemeleri Sıfırla ve Yeniden Kur' : 'Elemeleri Başlat (İlk ' + qCount + ')') + '</button>' +
      (started
        ? '<button class="ghost block" data-act="clear-playoffs" style="margin-top:10px;">Elemeyi Sil</button>'
        : '<div class="hint">Puan durumundaki ilk ' + qCount + ' oyuncu seri başı sırasına göre eşleşir.' +
          (!standings.leagueComplete() && standings.progress().total ? ' <strong>Lig henüz bitmedi.</strong>' : '') + '</div>') +
      '</div>';

    if (!started) {
      return html + '<div class="empty">Eleme aşaması henüz başlamadı.' +
        (canEdit() ? '' : '<br>Başlatmak için şifre gerekir.') + '</div>';
    }

    html += '<div class="bracket">';
    rs.forEach(function (rn) {
      var ms = playoffs.roundMatches(rn);
      html += '<div class="bracket-col"><div class="section-title">' + esc(playoffs.roundName(ms.length * 2)) + '</div>' +
        ms.map(function (m) { return matchCard(m, { compact: true }); }).join('') + '</div>';
    });
    html += '</div>';

    var champ = playoffs.champion();
    if (champ) {
      var second = playoffs.runnerUp();
      html += '<div class="champion">' + avatar(store.playerName(champ), 'lg') +
        '<div class="sub">Şampiyon</div><div class="name">' + esc(store.playerName(champ)) + '</div>' +
        (second ? '<div class="second">İkinci: ' + esc(store.playerName(second)) + '</div>' : '') + '</div>';
    } else {
      var last = rs[rs.length - 1];
      var ready = playoffs.roundDecided(last);
      if (canEdit()) {
        html += '<div class="card"><button class="block" data-act="next-round"' + (ready ? '' : ' disabled') + '>Sonraki Turu Oluştur</button>' +
          (ready ? '' : '<div class="hint">Bu turdaki tüm maçlar bitince aktifleşir.</div>') + '</div>';
      }
    }
    return html;
  }

  /* ---------- Ayarlar ---------- */

  function renderSettings() {
    var c = store.settings;
    var gameOpts = [1, 2, 3, 4, 5].map(function (v) {
      return '<option value="' + v + '"' + (c.gamesToWinSet === v ? ' selected' : '') + '>' + v + ' oyun</option>';
    }).join('');
    var setOpts = [1, 2, 3, 4, 5].map(function (v) {
      return '<option value="' + v + '"' + (c.setsToWinMatch === v ? ' selected' : '') + '>' + v + ' set (en fazla ' + (v * 2 - 1) + ' set)</option>';
    }).join('');
    var sizeOpts = [2, 4, 8, 16, 32].map(function (v) {
      return '<option value="' + v + '"' + (c.playoffSize === v ? ' selected' : '') + '>İlk ' + v + '</option>';
    }).join('');
    var themeOpts = [['auto', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']].map(function (o) {
      return '<option value="' + o[0] + '"' + (store.prefs.theme === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('');

    if (!canEdit()) {
      return lockedHint('Turnuva ayarlarını değiştirmek için şifre gerekir.') +
        '<div class="section-title">Görünüm</div><div class="card">' +
        '<label class="field" for="set_theme">Tema</label>' +
        '<select id="set_theme" data-act="setting" data-key="theme">' + themeOpts + '</select></div>' +
        '<div class="section-title">Veri</div><div class="card">' +
        '<button class="secondary block" data-act="export">Yedek Al (JSON indir)</button>' +
        '<div class="hint">İzleme modunda tabloyu yedekleyebilirsin; değiştiremezsin.</div></div>';
    }

    var samples = rules.winningSetScores(c).map(function (s) { return s[0] + '-' + s[1]; }).join(', ');

    var html = '<div class="section-title">Maç Formatı</div><div class="card">' +
      '<div class="field-group"><label class="field" for="set_pointsPerGame">Bir oyun kaç sayı</label>' +
      '<input type="number" id="set_pointsPerGame" data-act="setting" data-key="pointsPerGame" ' +
      'value="' + c.pointsPerGame + '" min="1" max="99" inputmode="numeric">' +
      '<div class="hint">Sadece <strong>detaylı giriş</strong> modunda sorulur: oyun skorları ' +
      c.pointsPerGame + '-0 … ' + c.pointsPerGame + '-' + (c.pointsPerGame - 1) + '.</div></div>' +
      '<div class="field-group"><label class="field" for="set_gamesToWinSet">Seti kazanmak için oyun</label>' +
      '<select id="set_gamesToWinSet" data-act="setting" data-key="gamesToWinSet">' + gameOpts + '</select>' +
      '<div class="hint">Set skorları: ' + esc(samples) + ' (ve aynaları).</div></div>' +
      '<div class="field-group"><label class="field" for="set_setsToWinMatch">Maçı kazanmak için set</label>' +
      '<select id="set_setsToWinMatch" data-act="setting" data-key="setsToWinMatch">' + setOpts + '</select>' +
      '<div class="hint">Maç en fazla ' + rules.maxSets(c) + ' set sürer.</div></div>' +
      '</div>';

    html += '<div class="section-title">Lig</div><div class="card">' +
      '<label class="switch"><input type="checkbox" data-act="setting" data-key="doubleRound"' +
      (c.doubleRound ? ' checked' : '') + '><span>Çift devreli lig</span></label>' +
      '<div class="hint">Kapalıysa herkes birbiriyle 1 kez oynar. Değişiklikten sonra fikstürü yeniden oluşturun.</div>' +
      '<div class="two-col" style="margin-top:12px;">' +
      '<div><label class="field" for="set_winPoints">Galibiyet puanı</label>' +
      '<input type="number" id="set_winPoints" data-act="setting" data-key="winPoints" value="' + c.winPoints + '" min="0" max="10" inputmode="numeric"></div>' +
      '<div><label class="field" for="set_lossPoints">Mağlubiyet puanı</label>' +
      '<input type="number" id="set_lossPoints" data-act="setting" data-key="lossPoints" value="' + c.lossPoints + '" min="0" max="10" inputmode="numeric"></div>' +
      '</div></div>';

    html += '<div class="section-title">Eleme</div><div class="card">' +
      '<label class="field" for="set_playoffSize">Elemeye çıkan oyuncu</label>' +
      '<select id="set_playoffSize" data-act="setting" data-key="playoffSize">' + sizeOpts + '</select>' +
      '<div class="hint">Oyuncu sayısı yetmezse eksik seri başları BAY olur.</div></div>';

    html += '<div class="section-title">Görünüm</div><div class="card">' +
      '<label class="field" for="set_theme">Tema</label>' +
      '<select id="set_theme" data-act="setting" data-key="theme">' + themeOpts + '</select></div>';

    html += '<div class="section-title">Veri</div><div class="card stack">' +
      '<button class="secondary block" data-act="export">Yedek Al (JSON indir)</button>' +
      '<button class="secondary block" data-act="import">Yedekten Yükle</button>' +
      '<button class="ghost block" data-act="clear-scores">Tüm Skorları Temizle</button>' +
      '<button class="danger block" data-act="reset-all">Her Şeyi Sıfırla</button>' +
      '<div class="hint">Veriler yalnızca bu tarayıcıda saklanır. Turnuva sırasında düzenli yedek alın.</div></div>';

    return html;
  }

  /* ---------- Maç skoru sayfası ---------- */

  function renderMatchSheet(m) {
    var c = store.settings;
    var s = rules.matchSetsWon(m, c);
    var w = rules.matchWinner(m, c);
    var list = rules.sets(m);
    var active = rules.activeSetIndex(m, c);
    var wins = rules.winningSetScores(c);
    var mode = store.prefs.inputMode === 'detailed' ? 'detailed' : 'fast';

    var html = sheetHead(
      esc(store.playerName(m.p1)) + ' <i>—</i> ' + esc(store.playerName(m.p2)),
      esc(phaseLabel(m)) + ' · en fazla ' + rules.maxSets(c) + ' set'
    );

    html += '<div class="score-hero">' +
      '<div class="sh-side' + (w === 'a' ? ' win' : '') + '">' + avatar(store.playerName(m.p1), 'lg') +
      '<span>' + esc(store.playerName(m.p1)) + '</span></div>' +
      '<div class="sh-score">' + (list.length ? s.a + '<i>:</i>' + s.b : '<i>–</i>') + '</div>' +
      '<div class="sh-side' + (w === 'b' ? ' win' : '') + '">' + avatar(store.playerName(m.p2), 'lg') +
      '<span>' + esc(store.playerName(m.p2)) + '</span></div>' +
      '</div>';

    if (active >= 0 && canEdit()) {
      html += '<div class="seg-group mode-seg">' +
        '<button class="seg' + (mode === 'fast' ? ' on' : '') + '" data-act="input-mode" data-v="fast">Hızlı giriş</button>' +
        '<button class="seg' + (mode === 'detailed' ? ' on' : '') + '" data-act="input-mode" data-v="detailed">Detaylı giriş</button>' +
        '</div>' +
        '<div class="mode-hint">' + (mode === 'fast'
          ? 'Maç bittikten sonra: her setin oyun skorunu tek dokunuşla gir.'
          : 'Oynarken: her oyunun sayısını gir, setler kendiliğinden kapanır.') + '</div>';
    }

    if (list.length) {
      html += '<div class="setlist">' + list.map(function (set, i) {
        var sw = rules.setWinner(set, c);
        var open = !sw;
        var detail = rules.gameDetail(set);
        return '<div class="sl-row' + (open ? ' open' : '') + '">' +
          '<span class="sl-no">Set ' + (i + 1) + '</span>' +
          '<span class="sl-score"><b' + (sw === 'a' ? ' class="w"' : '') + '>' + set.a + '</b>' +
          '<i>-</i><b' + (sw === 'b' ? ' class="w"' : '') + '>' + set.b + '</b></span>' +
          '<span class="sl-who">' + (sw ? esc(store.playerName(sw === 'a' ? m.p1 : m.p2)) : 'devam ediyor') +
          (detail ? '<small>' + esc(detail) + '</small>' : '') + '</span>' +
          (canEdit() ? '<button class="ghost tiny" data-act="del-set" data-i="' + i + '">Sil</button>' : '') +
          '</div>';
      }).join('') + '</div>';
    }

    if (active >= 0 && !canEdit()) {
      html += lockedHint('Bu maçın skorunu girmek için şifre gerekir.');
    } else if (active >= 0 && mode === 'fast') {
      html += '<div class="section-title">' + (active + 1) + '. Setin Oyun Skoru</div>' +
        '<div class="picker">' +
        pickerRow(store.playerName(m.p1) + ' aldı', wins, 'add-set') +
        pickerRow(store.playerName(m.p2) + ' aldı', mirror(wins), 'add-set') +
        '</div>';
    } else if (active >= 0) {
      var openSet = rules.openSet(m, c);
      var played = openSet && openSet.games ? openSet.games.length : 0;
      var gwins = rules.winningGameScores(c);
      html += '<div class="section-title">' + (active + 1) + '. Set · ' + (played + 1) + '. Oyunun Sayısı</div>' +
        '<div class="picker">' +
        pickerRow(store.playerName(m.p1) + ' kazandı', gwins, 'add-game') +
        pickerRow(store.playerName(m.p2) + ' kazandı', mirror(gwins), 'add-game') +
        '</div>';
      if (hasAnyGame(list)) {
        html += '<button class="ghost block" data-act="undo-game" style="margin-top:10px;">↶ Son Oyunu Geri Al</button>';
      }
    } else if (w) {
      html += '<div class="done-note">' + esc(store.playerName(w === 'a' ? m.p1 : m.p2)) + ' maçı ' +
        Math.max(s.a, s.b) + '-' + Math.min(s.a, s.b) + ' kazandı.</div>';
    }

    if (list.length && canEdit()) {
      html += '<button class="ghost block" data-act="clear-score" style="margin-top:10px;">Tüm Setleri Sil</button>';
    }
    return html;
  }

  function mirror(pairs) {
    return pairs.map(function (p) { return [p[1], p[0]]; });
  }

  function hasAnyGame(list) {
    for (var i = 0; i < list.length; i++) if (list[i].games && list[i].games.length) return true;
    return false;
  }

  function pickerRow(label, pairs, act) {
    return '<div class="picker-row"><div class="picker-label">' + esc(label) + '</div>' +
      '<div class="chips' + (pairs.length > 3 ? ' chips--tight' : '') + '">' +
      pairs.map(function (p) {
        return '<button class="chip" data-act="' + act + '" data-a="' + p[0] + '" data-b="' + p[1] + '">' +
          p[0] + '-' + p[1] + '</button>';
      }).join('') + '</div></div>';
  }

  /* ---------- Oyuncu profili ---------- */

  function renderPlayerSheet(p) {
    var st = standings.playerStats(p.id);
    if (!st) return sheetHead(esc(p.name), '') + '<div class="empty">İstatistik yok.</div>';

    var r = st.row;
    var av = r.setG - r.setK;

    var html = sheetHead(esc(p.name), r.oyn ? st.total + ' oyuncu içinde ' + r.sira + '. sırada' : 'Henüz maç oynamadı');

    html += '<div class="profile-head">' + avatar(p.name, 'lg') +
      '<div><div class="ph-name">' + esc(p.name) + '</div>' +
      '<div class="ph-sub">' + r.gal + ' galibiyet · ' + r.mag + ' mağlubiyet' +
      (st.remaining ? ' · ' + st.remaining + ' maç kaldı' : '') + '</div>' +
      (st.form.length ? '<div class="form-chips">' + st.form.map(function (won) {
        return '<span class="fc ' + (won ? 'w' : 'l') + '">' + (won ? 'G' : 'M') + '</span>';
      }).join('') + '</div>' : '') +
      '</div></div>';

    html += '<div class="stat-grid">' +
      statTile('Sıra', r.oyn ? r.sira + '<small>/' + st.total + '</small>' : '–') +
      statTile('Puan', r.puan) +
      statTile('Oynanan', r.oyn) +
      statTile('Galibiyet', '%' + st.winPct, r.gal + '-' + r.mag) +
      statTile('Set', r.setG + '-' + r.setK, '%' + st.setPct) +
      statTile('Oyun', r.oyunG + '-' + r.oyunK, '%' + st.gamePct) +
      statTile('Set av.', (av > 0 ? '+' : '') + av, 'oyun ' + (r.oyunG - r.oyunK > 0 ? '+' : '') + (r.oyunG - r.oyunK)) +
      statTile('Seri', (st.streak > 0 ? st.streak + 'G' : '–'), 'en iyi ' + st.bestStreak + 'G') +
      statTile('Eleme', st.eleme.oyn ? st.eleme.gal + '/' + st.eleme.oyn : '–', 'galibiyet') +
      '</div>';

    if (st.best || st.worst) {
      html += '<div class="note-grid">' +
        (st.best ? '<div class="note ok"><b>En farklı galibiyet</b>' + esc(st.best.text + ' — ' + st.best.oppName) + '</div>' : '') +
        (st.worst ? '<div class="note bad"><b>En ağır yenilgi</b>' + esc(st.worst.text + ' — ' + st.worst.oppName) + '</div>' : '') +
        '</div>';
    }

    if (st.opponents.length) {
      html += '<div class="section-title">Rakip Karşılaştırması</div><div class="table-wrap"><table class="mini">' +
        '<thead><tr><th>Rakip</th><th>O</th><th>G</th><th>M</th><th>Set</th><th>Oyun</th></tr></thead><tbody>';
      st.opponents.forEach(function (o) {
        html += '<tr data-act="open-player" data-id="' + esc(o.id) + '">' +
          '<td class="nmcell">' + avatar(o.name) + '<span>' + esc(o.name) + '</span></td>' +
          '<td>' + o.oyn + '</td>' +
          '<td class="' + (o.gal > o.mag ? 'pos' : '') + '">' + o.gal + '</td>' +
          '<td class="' + (o.mag > o.gal ? 'neg' : '') + '">' + o.mag + '</td>' +
          '<td>' + o.setG + '-' + o.setK + '</td>' +
          '<td>' + o.oyunG + '-' + o.oyunK + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }

    html += '<div class="section-title">Maç Geçmişi</div>';
    if (!st.history.length) {
      html += '<div class="empty">Fikstürde maçı yok.</div>';
    } else {
      html += '<div class="hist">' + st.history.map(function (h) {
        var tag = h.bye ? '<span class="hb bye">BAY</span>'
          : h.played ? (h.won ? '<span class="hb w">G</span>' : '<span class="hb l">M</span>')
            : h.started ? '<span class="hb live">•</span>'
              : '<span class="hb">—</span>';
        return '<button class="hrow" data-act="open-match" data-id="' + esc(h.id) + '"' + (h.bye ? ' disabled' : '') + '>' +
          tag +
          '<span class="hr-opp">' + esc(h.oppName) +
          (h.detail && (h.played || h.started)
            ? '<small class="hr-detail">' + esc(h.detail) + (h.played ? '' : ' · devam ediyor') + '</small>' : '') + '</span>' +
          '<span class="hr-meta">' + (h.phase === 'lig' ? h.round + '. Tur' : 'Eleme') + '</span>' +
          '<span class="hr-score' + (!h.played && h.started ? ' live' : '') + '">' +
          (h.bye ? '—' : (h.played || h.started) ? h.mine + '-' + h.theirs : '') + '</span>' +
          '</button>';
      }).join('') + '</div>';
    }

    if (canEdit()) {
      html += '<div class="row" style="margin-top:16px;gap:8px;">' +
        '<button class="secondary grow" data-act="rename-player" data-id="' + esc(p.id) + '">Adı Değiştir</button>' +
        '<button class="danger grow" data-act="del-player" data-id="' + esc(p.id) + '">Oyuncuyu Sil</button>' +
        '</div>';
    }

    return html;
  }

  function sheetHead(title, sub) {
    return '<div class="sheet-head">' +
      (view.stack.length ? '<button class="back-btn" data-act="sheet-back" aria-label="Geri">‹</button>' : '') +
      '<div class="sh-title"><h3>' + title + '</h3>' + (sub ? '<div class="sh-sub">' + sub + '</div>' : '') + '</div>' +
      '<button class="close-x" data-act="close-sheet" aria-label="Kapat">×</button></div>';
  }

  /* ---------- Turnuva / senkronizasyon ---------- */

  var STATUS_LABEL = {
    setup: ['Kurulum', 'Ortak tablo henüz kurulmadı'],
    local: ['Yerel', 'Bu cihazda saklanıyor'],
    online: ['Bağlı', 'Değişiklikler paylaşılıyor'],
    syncing: ['Gönderiliyor', 'Değişiklikler yükleniyor'],
    offline: ['Çevrimdışı', 'Bağlantı yok — değişiklikler kuyrukta'],
    readonly: ['Salt okunur', 'Skor girmek için PIN gerekli']
  };

  /* Düzenleme yetkisi var mı? Yoksa değiştirme düğmeleri hiç çizilmez. */
  function canEdit() {
    return L.sync ? L.sync.canWrite() : true;
  }

  function lockedHint(metin) {
    return '<div class="note"><b>İzleme modu</b>' + esc(metin) +
      ' Sağ üstteki <strong>Şifre gir</strong> düğmesini kullan.</div>';
  }

  function syncInfo() {
    return L.sync ? L.sync.state() : { connected: false, status: 'local', pending: 0, canWrite: true };
  }

  /* Sağ üstteki tek düğme: kilitliyken "Şifre gir", açıkken düzenleme durumu. */
  function updateSyncChip() {
    var chip = util.el('syncChip');
    if (!chip) return;
    var s = syncInfo();
    var label, cls, title;

    if (s.status === 'offline') {
      label = 'Çevrimdışı';
      cls = 'offline';
      title = 'Sunucuya ulaşılamıyor. Girdiklerin kaydedilir, bağlantı gelince gönderilir.';
    } else if (s.canWrite && s.connected) {
      label = 'Düzenleme açık';
      cls = 'online';
      title = 'Skor girebilirsin. Kapatmak için dokun.';
    } else {
      label = 'Şifre gir';
      cls = 'locked';
      title = 'Şu an izleme modundasın. Skor girmek için şifre gerekir.';
    }

    chip.className = 'sync-chip s-' + cls;
    chip.innerHTML = '<span class="dot"></span><span class="txt">' + esc(label) + '</span>' +
      (s.pending ? '<span class="pending">' + s.pending + '</span>' : '');
    chip.title = title;
  }

  function renderSyncSheet() {
    var s = syncInfo();
    var html = sheetHead('Turnuva', (STATUS_LABEL[s.status] || STATUS_LABEL.local)[1]);

    if (!s.connected) {
      html += '<div class="note"><b>İzleme modu</b>' +
        (s.status === 'setup'
          ? 'Ortak tablo henüz kurulmadı. Sağ üstteki "Şifre gir" düğmesine dokunup bir şifre belirle — tablo o anda kurulur.'
          : 'Sunucuya ulaşılamıyor. Girdiklerin bu cihazda saklanır, bağlantı gelince gönderilir.') +
        '</div>';
      return html;
    }

    html += '<div class="card">' +
      '<div class="stat-grid">' +
      statTile('Tablo', s.code === L.sync.defaultCode ? 'Ortak' : esc(s.code)) +
      statTile('Sürüm', s.version) +
      statTile('Bekleyen', s.pending) +
      '</div>' +
      '<div class="hint"><strong>' + esc(s.name) + '</strong> — ' + esc((STATUS_LABEL[s.status] || STATUS_LABEL.local)[1]) + '</div>' +
      '</div>';

    var isDefault = s.code === L.sync.defaultCode;
    html += '<div class="section-title">Paylaş</div><div class="card">' +
      '<div class="share-url">' + esc(isDefault ? location.origin + location.pathname : L.sync.shareUrl()) + '</div>' +
      '<button class="secondary block" data-act="sync-copy" style="margin-top:10px;">Linki Kopyala</button>' +
      '<div class="hint">' + (isDefault
        ? 'Bu ortak tablo. Adresi açan herkes aynı fikstürü ve puan durumunu görür — kod girmeye gerek yok.'
        : 'Linki olan herkes bu turnuvayı görür.') +
      ' Skor girmek için PIN gerekir.</div></div>';

    html += '<div class="section-title">Skor girişi</div><div class="card">';
    if (s.canWrite) {
      html += '<div class="done-note">Şifre girildi — skor girebilirsin.</div>' +
        '<button class="secondary block" data-act="sync-change-pin" style="margin-top:10px;">Şifreyi Değiştir</button>' +
        '<button class="ghost block" data-act="sync-signout" style="margin-top:8px;">Düzenlemeyi Kapat</button>' +
        '<div class="hint">Şifre değiştirmek <strong>veriyi silmez</strong>. Diğer cihazlarda açık olan düzenleme oturumları kapanır.</div>';
    } else {
      html += '<div class="row"><input type="password" id="syncPinIn" class="grow" maxlength="32" placeholder="Turnuva PIN\'i" autocomplete="off">' +
        '<button data-act="sync-pin">Giriş</button></div>' +
        '<div class="hint">PIN sunucuda doğrulanır; 8 hatalı denemede 10 dakika kilitlenir.</div>';
    }
    html += '</div>';

    html += '<div class="section-title">Bağlantı</div><div class="card stack">' +
      '<button class="secondary block" data-act="sync-refresh">Sunucudan Yenile</button>' +
      '<button class="ghost block" data-act="sync-leave">Bağlantıyı Kes (yerel moda dön)</button>' +
      '<div class="hint">Bağlantıyı kesmek turnuvayı silmez; bu cihaz yerel kopyayla devam eder.</div>' +
      '</div>';

    return html;
  }

  /* ---------- sheet yönetimi ---------- */

  function renderSheet() {
    var overlay = util.el('overlay');
    var sheet = util.el('sheet');
    if (!view.sheet) { overlay.hidden = true; sheet.innerHTML = ''; return; }

    var html = '';
    if (view.sheet.type === 'sync') {
      html = renderSyncSheet();
    } else if (view.sheet.type === 'match') {
      var m = store.matchById(view.sheet.id);
      if (!m) { closeSheet(); return; }
      html = renderMatchSheet(m);
    } else {
      var p = store.playerById(view.sheet.id);
      if (!p) { closeSheet(); return; }
      html = renderPlayerSheet(p);
    }
    var prev = sheet.scrollTop;
    sheet.innerHTML = html;
    overlay.hidden = false;
    sheet.scrollTop = prev;
  }

  function openSheet(type, id, push) {
    if (push && view.sheet) view.stack.push(view.sheet);
    view.sheet = { type: type, id: id };
    var sheet = util.el('sheet');
    if (push) sheet.scrollTop = 0;
    renderSheet();
    if (push) sheet.scrollTop = 0;
  }

  function openMatch(id) {
    var m = store.matchById(id);
    if (!m || rules.isBye(m)) return;
    openSheet('match', id, !!view.sheet);
  }

  function openPlayer(id) {
    if (!store.playerById(id)) return;
    openSheet('player', id, !!view.sheet);
  }

  function openSync() { openSheet('sync', null, !!view.sheet); }

  function sheetBack() {
    var prev = view.stack.pop();
    if (!prev) { closeSheet(); return; }
    view.sheet = prev;
    renderSheet();
  }

  function closeSheet() {
    view.sheet = null;
    view.stack = [];
    util.el('overlay').hidden = true;
    util.el('sheet').innerHTML = '';
  }

  /* ---------- kök ---------- */

  function applyTheme() {
    var t = store.prefs.theme;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }

  function render() {
    applyTheme();
    updateSyncChip();
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].dataset.tab === view.tab;
      tabs[i].classList.toggle('active', on);
      tabs[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }
    var main = util.el('main');
    if (view.tab === 'oyuncular') main.innerHTML = renderPlayers();
    else if (view.tab === 'fikstur') main.innerHTML = renderFixture();
    else if (view.tab === 'puan') main.innerHTML = renderStandings();
    else if (view.tab === 'eleme') main.innerHTML = renderPlayoffs();
    else main.innerHTML = renderSettings();

    renderSheet();
  }

  global.LIG.ui = {
    view: view,
    render: render,
    renderSheet: renderSheet,
    openMatch: openMatch,
    openPlayer: openPlayer,
    openSync: openSync,
    updateSyncChip: updateSyncChip,
    sheetBack: sheetBack,
    closeSheet: closeSheet,
    applyTheme: applyTheme
  };
})(window);
