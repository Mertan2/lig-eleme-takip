/* Cloudflare Pages Function — turnuva API'si.
 *
 * Uç noktalar (hepsi /api altında):
 *   POST   /api/tournaments                 {name, pin}          -> {code, token, version}
 *   GET    /api/tournaments/:code                                -> {code, name, state, version, updatedAt}
 *   GET    /api/tournaments/:code/version                        -> {version, updatedAt}
 *   POST   /api/tournaments/:code/auth      {pin}                -> {token, expiresAt}
 *   POST   /api/tournaments/:code/patch     {baseVersion, patch} -> {version, state}   [token gerekir]
 *
 * Okuma herkese açık; yazma için PIN ile alınmış token şart. PIN doğrulaması
 * yalnızca sunucuda yapılır, hash'i istemciye hiç gönderilmez.
 */

const MAX_STATE_CHARS = 512 * 1024;
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;   // 12 saat
const PIN_MAX_FAILS = 8;
const PIN_LOCK_MS = 10 * 60 * 1000;         // 10 dakika
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışan harfler yok

/* ---------- yardımcılar ---------- */

const enc = new TextEncoder();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400'
};

/* 204 gövde kabul etmez; ön kontrol yanıtı ayrı üretilir. */
function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...CORS,
      ...extraHeaders
    }
  });
}

function fail(status, code, message) {
  return json({ error: code, message: message }, status);
}

function b64url(bytes) {
  let s = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomCode(len = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

async function pbkdf2(pin, saltB64) {
  const salt = Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256
  );
  return b64url(bits);
}

/* Sabit süreli karşılaştırma. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

async function makeToken(secret, code) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const body = code + '.' + exp;
  return { token: body + '.' + (await hmac(secret, body)), expiresAt: exp };
}

async function verifyToken(secret, code, token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [tCode, expStr, sig] = parts;
  if (tCode !== code) return false;
  const exp = Number(expStr);
  if (!isFinite(exp) || exp < Date.now()) return false;
  const expected = await hmac(secret, tCode + '.' + expStr);
  return timingSafeEqual(sig, expected);
}

function bearer(request) {
  const h = request.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

function secretOf(env) {
  const s = env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET tanımlı değil.');
  return s;
}

async function readJSON(request) {
  try {
    const text = await request.text();
    if (text.length > MAX_STATE_CHARS + 4096) return { tooBig: true };
    return { data: JSON.parse(text) };
  } catch (e) {
    return { bad: true };
  }
}

/* ---------- patch uygulama (oyun kurallarından bağımsız) ---------- */

function upsertMatches(list, incoming) {
  const byId = new Map(list.map(m => [m.id, m]));
  for (const m of incoming) {
    if (!m || typeof m.id !== 'string') continue;
    byId.set(m.id, m);
  }
  return Array.from(byId.values());
}

function applyPatch(state, patch) {
  const next = {
    v: state.v,
    settings: state.settings || {},
    players: Array.isArray(state.players) ? state.players : [],
    matches: Array.isArray(state.matches) ? state.matches : [],
    playoffRound: state.playoffRound || 0
  };

  if (patch.replaceAll && typeof patch.replaceAll === 'object') {
    return patch.replaceAll;
  }
  if (patch.settings && typeof patch.settings === 'object') {
    next.settings = { ...next.settings, ...patch.settings };
  }
  if (Array.isArray(patch.players)) {
    next.players = patch.players;
  }
  if (Array.isArray(patch.matchesReplace)) {
    next.matches = patch.matchesReplace;
  }
  if (Array.isArray(patch.matchUpsert)) {
    next.matches = upsertMatches(next.matches, patch.matchUpsert);
  }
  if (Array.isArray(patch.matchRemove)) {
    const drop = new Set(patch.matchRemove);
    next.matches = next.matches.filter(m => !drop.has(m.id));
  }
  if (typeof patch.playoffRound === 'number') {
    next.playoffRound = patch.playoffRound;
  }

  // Silinen oyuncuya bağlı maçlar sunucuda da temizlenir.
  const ids = new Set(next.players.map(p => p && p.id));
  next.matches = next.matches.filter(m => m && ids.has(m.p1) && (m.p2 == null || ids.has(m.p2)));

  return next;
}

/* ---------- uç noktalar ---------- */

async function createTournament(env, request) {
  const body = await readJSON(request);
  if (body.tooBig) return fail(413, 'too_large', 'Veri çok büyük.');
  if (body.bad) return fail(400, 'bad_json', 'Geçersiz istek.');

  const { name, pin, state } = body.data || {};
  if (typeof name !== 'string' || !name.trim()) return fail(400, 'bad_name', 'Turnuva adı gerekli.');
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 32) {
    return fail(400, 'bad_pin', 'PIN en az 4, en fazla 32 karakter olmalı.');
  }

  // İstemci sabit bir kod isteyebilir (tek ortak turnuva kurulumu için).
  const wanted = typeof (body.data || {}).code === 'string'
    ? body.data.code.trim().toUpperCase() : '';
  if (wanted && !/^[A-Z0-9]{4,12}$/.test(wanted)) {
    return fail(400, 'bad_code', 'Geçersiz turnuva kodu.');
  }

  const stateJSON = JSON.stringify(state && typeof state === 'object' ? state : {});
  if (stateJSON.length > MAX_STATE_CHARS) return fail(413, 'too_large', 'Turnuva verisi çok büyük.');

  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await pbkdf2(pin, salt);
  const now = Date.now();

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = wanted || randomCode();
    try {
      await env.DB.prepare(
        `INSERT INTO tournaments (code, name, state, version, pin_hash, pin_salt, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
      ).bind(code, name.trim().slice(0, 80), stateJSON, hash, salt, now, now).run();

      const { token, expiresAt } = await makeToken(secretOf(env), code);
      return json({ code, name: name.trim().slice(0, 80), version: 1, token, expiresAt }, 201);
    } catch (e) {
      if (!String(e && e.message).includes('UNIQUE')) throw e;
      // İstenen kod doluysa tekrar denemenin anlamı yok.
      if (wanted) return fail(409, 'code_taken', 'Bu turnuva zaten var.');
    }
  }
  return fail(500, 'code_collision', 'Turnuva kodu üretilemedi, tekrar deneyin.');
}

async function getTournament(env, code) {
  const row = await env.DB.prepare(
    'SELECT code, name, state, version, updated_at FROM tournaments WHERE code = ?'
  ).bind(code).first();
  // Tablo henüz kurulmamış olmak normal bir durum, hata değil:
  // 404 yerine found:false döner ki tarayıcı konsolunda hata gibi görünmesin.
  if (!row) return json({ code, found: false });
  let state;
  try { state = JSON.parse(row.state); } catch (e) { state = {}; }
  return json({ code: row.code, found: true, name: row.name, state, version: row.version, updatedAt: row.updated_at });
}

async function getVersion(env, code) {
  const row = await env.DB.prepare(
    'SELECT version, updated_at FROM tournaments WHERE code = ?'
  ).bind(code).first();
  if (!row) return fail(404, 'not_found', 'Turnuva bulunamadı.');
  return json({ version: row.version, updatedAt: row.updated_at });
}

async function authTournament(env, code, request) {
  const body = await readJSON(request);
  if (body.bad) return fail(400, 'bad_json', 'Geçersiz istek.');
  const pin = (body.data || {}).pin;
  if (typeof pin !== 'string' || !pin) return fail(400, 'bad_pin', 'PIN gerekli.');

  const row = await env.DB.prepare(
    'SELECT pin_hash, pin_salt, pin_fails, locked_until FROM tournaments WHERE code = ?'
  ).bind(code).first();
  if (!row) return fail(404, 'not_found', 'Turnuva bulunamadı.');

  const now = Date.now();
  if (row.locked_until && row.locked_until > now) {
    const mins = Math.ceil((row.locked_until - now) / 60000);
    return fail(429, 'locked', 'Çok fazla hatalı deneme. ' + mins + ' dakika sonra tekrar deneyin.');
  }

  const hash = await pbkdf2(pin, row.pin_salt);
  if (!timingSafeEqual(hash, row.pin_hash)) {
    const fails = (row.pin_fails || 0) + 1;
    const lockUntil = fails >= PIN_MAX_FAILS ? now + PIN_LOCK_MS : 0;
    await env.DB.prepare('UPDATE tournaments SET pin_fails = ?, locked_until = ? WHERE code = ?')
      .bind(lockUntil ? 0 : fails, lockUntil, code).run();
    return fail(403, 'bad_pin', 'PIN hatalı.');
  }

  await env.DB.prepare('UPDATE tournaments SET pin_fails = 0, locked_until = 0 WHERE code = ?')
    .bind(code).run();
  const { token, expiresAt } = await makeToken(secretOf(env), code);
  return json({ token, expiresAt });
}

async function patchTournament(env, code, request) {
  if (!(await verifyToken(secretOf(env), code, bearer(request)))) {
    return fail(401, 'unauthorized', 'Yazma izni yok. PIN ile giriş yapın.');
  }
  const body = await readJSON(request);
  if (body.tooBig) return fail(413, 'too_large', 'Veri çok büyük.');
  if (body.bad) return fail(400, 'bad_json', 'Geçersiz istek.');

  const { patch, baseVersion } = body.data || {};
  if (!patch || typeof patch !== 'object') return fail(400, 'bad_patch', 'Patch gerekli.');

  const row = await env.DB.prepare(
    'SELECT state, version FROM tournaments WHERE code = ?'
  ).bind(code).first();
  if (!row) return fail(404, 'not_found', 'Turnuva bulunamadı.');

  let state;
  try { state = JSON.parse(row.state); } catch (e) { state = {}; }

  const next = applyPatch(state, patch);
  const nextJSON = JSON.stringify(next);
  if (nextJSON.length > MAX_STATE_CHARS) return fail(413, 'too_large', 'Turnuva verisi çok büyük.');

  const version = row.version + 1;
  const now = Date.now();
  await env.DB.prepare('UPDATE tournaments SET state = ?, version = ?, updated_at = ? WHERE code = ? AND version = ?')
    .bind(nextJSON, version, now, code, row.version).run();

  // Sürüm arada değiştiyse istemci güncel hali alsın diye state hep geri döner.
  return json({ version, state: next, updatedAt: now, rebased: baseVersion !== row.version });
}

/* ---------- yönlendirici ---------- */

export async function onRequest(context) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') return preflight();

  const segments = Array.isArray(params.path) ? params.path : String(params.path || '').split('/');
  const clean = segments.filter(Boolean);

  try {
    if (!env.DB) return fail(500, 'no_db', 'D1 veritabanı bağlı değil (binding: DB).');

    if (clean[0] !== 'tournaments') return fail(404, 'not_found', 'Bilinmeyen uç nokta.');

    if (clean.length === 1) {
      if (request.method === 'POST') return await createTournament(env, request);
      return fail(405, 'method', 'Yalnızca POST.');
    }

    const code = String(clean[1] || '').toUpperCase().slice(0, 12);
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return fail(400, 'bad_code', 'Geçersiz turnuva kodu.');

    if (clean.length === 2 && request.method === 'GET') return await getTournament(env, code);
    if (clean.length === 3 && clean[2] === 'version' && request.method === 'GET') return await getVersion(env, code);
    if (clean.length === 3 && clean[2] === 'auth' && request.method === 'POST') return await authTournament(env, code, request);
    if (clean.length === 3 && clean[2] === 'patch' && request.method === 'POST') return await patchTournament(env, code, request);

    return fail(404, 'not_found', 'Bilinmeyen uç nokta.');
  } catch (e) {
    return fail(500, 'server_error', String((e && e.message) || e));
  }
}
