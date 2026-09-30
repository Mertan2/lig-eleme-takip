/* Küçük yardımcılar: kaçış, id, toast, dialog. */
(function (global) {
  'use strict';

  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function clampInt(v, min, max, fallback) {
    var n = parseInt(v, 10);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function el(id) { return document.getElementById(id); }

  /* ---- Toast ---- */
  function toast(msg, kind) {
    var wrap = el('toasts');
    if (!wrap) return;
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    wrap.appendChild(t);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    setTimeout(function () {
      t.style.transition = 'opacity .25s ease';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 260);
    }, kind === 'err' ? 3200 : 2200);
  }

  /* ---- Modal dialogs (confirm / prompt) ---- */
  var modalResolve = null;

  function closeModal(value) {
    var overlay = el('modal');
    overlay.hidden = true;
    el('dialog').innerHTML = '';
    document.removeEventListener('keydown', onModalKey, true);
    var r = modalResolve;
    modalResolve = null;
    if (r) r(value);
  }

  function onModalKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // alttaki sheet'in de kapanmasını engelle
      closeModal(null);
    }
  }

  function openModal(html, wire) {
    var overlay = el('modal');
    var box = el('dialog');
    box.innerHTML = html;
    overlay.hidden = false;
    document.addEventListener('keydown', onModalKey, true);
    overlay.onclick = function (e) { if (e.target === overlay) closeModal(null); };
    wire(box);
    return new Promise(function (resolve) { modalResolve = resolve; });
  }

  function confirmDialog(message, opts) {
    opts = opts || {};
    var html =
      '<h3>' + esc(opts.title || 'Emin misiniz?') + '</h3>' +
      '<p>' + esc(message) + '</p>' +
      '<div class="actions">' +
      '<button class="ghost" data-x="cancel">' + esc(opts.cancelLabel || 'Vazgeç') + '</button>' +
      '<button class="' + (opts.danger ? 'danger' : '') + '" data-x="ok">' + esc(opts.okLabel || 'Devam') + '</button>' +
      '</div>';
    return openModal(html, function (box) {
      box.querySelector('[data-x="cancel"]').onclick = function () { closeModal(false); };
      var ok = box.querySelector('[data-x="ok"]');
      ok.onclick = function () { closeModal(true); };
      ok.focus();
    }).then(function (v) { return v === true; });
  }

  function promptDialog(label, value, opts) {
    opts = opts || {};
    var html =
      '<h3>' + esc(opts.title || 'Düzenle') + '</h3>' +
      '<div class="field-group"><label class="field" for="dlgInput">' + esc(label) + '</label>' +
      '<input type="text" id="dlgInput" value="' + esc(value || '') + '" maxlength="40" autocomplete="off"></div>' +
      '<div class="actions">' +
      '<button class="ghost" data-x="cancel">Vazgeç</button>' +
      '<button data-x="ok">' + esc(opts.okLabel || 'Kaydet') + '</button>' +
      '</div>';
    return openModal(html, function (box) {
      var input = box.querySelector('#dlgInput');
      var submit = function () { closeModal(input.value.trim()); };
      box.querySelector('[data-x="cancel"]').onclick = function () { closeModal(null); };
      box.querySelector('[data-x="ok"]').onclick = submit;
      input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
      input.focus();
      input.select();
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return Promise.resolve(ok);
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function downloadFile(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function pickFile(accept) {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '.json,application/json';
      input.onchange = function () {
        var f = input.files && input.files[0];
        if (!f) return resolve(null);
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result)); };
        fr.onerror = function () { resolve(null); };
        fr.readAsText(f);
      };
      input.click();
    });
  }

  global.LIG = global.LIG || {};
  global.LIG.util = {
    esc: esc,
    uid: uid,
    clampInt: clampInt,
    el: el,
    toast: toast,
    confirm: confirmDialog,
    prompt: promptDialog,
    closeModal: closeModal,
    copyText: copyText,
    downloadFile: downloadFile,
    pickFile: pickFile
  };
})(window);
