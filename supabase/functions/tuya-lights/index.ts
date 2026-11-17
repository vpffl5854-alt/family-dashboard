// Supabase Edge Function: tuya-lights
// Smart Life(Tuya) 'sharing' 프로토콜로 집 조명을 제어한다.
//   - 토큰은 public.tuya_connections (service_role 전용)에만 있다.
//   - 브라우저는 x-room-code 헤더로 자기 방의 기기만 본다.
// 프로토콜 출처: tuya-device-sharing-sdk / tuya_sharing/customerapi.py

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-room-code',
  'Access-Control-Max-Age': '86400',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NONCE_CHARS = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';

type Conn = {
  room_id: string;
  home_id: string;
  client_id: string;
  user_code: string;
  terminal_id: string;
  endpoint: string;
  uid: string;
  access_token: string;
  refresh_token: string;
  expire_at_ms: number;
  switch_labels: Record<string, string>;
};

// ---------------------------------------------------------------- encoders
const enc = new TextEncoder();
const dec = new TextDecoder();

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- MD5 (WebCrypto 엔 없어서 직접 구현)
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = (() => {
  const k = new Uint32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  return k;
})();

function md5hex(input: Uint8Array): string {
  const len = input.length;
  const nBlocks = ((len + 8) >>> 6) + 1;
  const words = new Uint32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= input[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  const bitLen = len * 8;
  words[nBlocks * 16 - 2] = bitLen >>> 0;
  words[nBlocks * 16 - 1] = Math.floor(bitLen / 4294967296) >>> 0;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) >>> 0;
  const M = new Uint32Array(16);

  for (let blk = 0; blk < nBlocks; blk++) {
    for (let i = 0; i < 16; i++) M[i] = words[blk * 16 + i];
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => {
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  });
  return toHex(out);
}

// ---------------------------------------------------------------- app crypto
async function hmacHex(keyText: string, msgText: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgText));
  return toHex(new Uint8Array(sig));
}

function randomNonce(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  let s = '';
  for (const b of buf) s += NONCE_CHARS[b % NONCE_CHARS.length];
  return s;
}

async function aesKey(secret: string, usage: 'encrypt' | 'decrypt') {
  return await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'AES-GCM' }, false, [usage]);
}

async function encryptJson(obj: unknown, secret: string): Promise<string> {
  const nonce = randomNonce(12);
  const key = await aesKey(secret, 'encrypt');
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: enc.encode(nonce) }, key, enc.encode(JSON.stringify(obj)),
  ));
  return b64(enc.encode(nonce)) + b64(ct);
}

async function decryptJson(payload: string, secret: string): Promise<unknown> {
  const raw = unb64(payload);
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const key = await aesKey(secret, 'decrypt');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(dec.decode(pt));
}

// ---------------------------------------------------------------- tuya http
class TuyaApiError extends Error {
  code: string;
  expired: boolean;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.expired = ['1010', '1011', '1013', '1014', 'TOKEN_EXPIRED', 'TOKEN_INVALID'].includes(code) ||
      /token/i.test(message);
  }
}

async function tuyaCall(
  conn: Conn, method: string, path: string,
  query?: Record<string, unknown>, body?: unknown,
): Promise<{ result: any; top: any }> {
  const rid = crypto.randomUUID();
  const hashKey = md5hex(enc.encode(rid + conn.refresh_token));
  const secret = (await hmacHex(rid, hashKey)).slice(0, 16);

  let queryEnc = '';
  let url = conn.endpoint.replace(/\/$/, '') + path;
  if (query && Object.keys(query).length) {
    queryEnc = await encryptJson(query, secret);
    url += (path.includes('?') ? '&' : '?') + 'encdata=' + encodeURIComponent(queryEnc);
  }
  let bodyEnc = '';
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    bodyEnc = await encryptJson(body, secret);
    payload = JSON.stringify({ encdata: bodyEnc });
  }

  const t = String(Date.now());
  const headers: Record<string, string> = {
    'X-appKey': conn.client_id,
    'X-requestId': rid,
    'X-sid': '',
    'X-time': t,
  };
  if (conn.access_token) headers['X-token'] = conn.access_token;
  const signParts = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token']
    .filter((k) => k !== 'X-sid' && headers[k])
    .map((k) => `${k}=${headers[k]}`)
    .join('||');
  headers['X-sign'] = await hmacHex(hashKey, signParts + queryEnc + bodyEnc);
  headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: payload,
    signal: AbortSignal.timeout(15000),
  });
  const raw = await res.text();
  let ret: any;
  try {
    ret = JSON.parse(raw);
  } catch {
    throw new TuyaApiError(String(res.status), `Tuya 응답 형식 오류 (${res.status})`);
  }
  if (!res.ok && !ret?.success) {
    throw new TuyaApiError(String(ret?.code ?? res.status), ret?.msg ?? `HTTP ${res.status}`);
  }
  if (ret.success !== true) {
    throw new TuyaApiError(String(ret.code ?? ''), String(ret.msg ?? 'Tuya 요청 실패'));
  }
  const result = ret.result ? await decryptJson(String(ret.result), secret) : null;
  return { result, top: ret };
}

// ---------------------------------------------------------------- postgrest
function sbHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbSelect(table: string, query: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`${table} select ${res.status}: ${await res.text()}`);
  return await res.json();
}

async function sbPatch(table: string, query: string, patch: unknown): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`${table} patch ${res.status}: ${await res.text()}`);
}

// ---------------------------------------------------------------- token
async function refreshConn(conn: Conn): Promise<Conn> {
  // 동시 호출로 이미 다른 요청이 갱신했을 수 있으니 최신 행을 먼저 확인한다.
  const [fresh] = await sbSelect(
    'tuya_connections',
    `select=access_token,refresh_token,expire_at_ms&room_id=eq.${encodeURIComponent(conn.room_id)}`,
  );
  if (fresh && (fresh.access_token !== conn.access_token) && Number(fresh.expire_at_ms) > Date.now()) {
    return { ...conn, ...fresh, expire_at_ms: Number(fresh.expire_at_ms) };
  }
  const { result, top } = await tuyaCall(conn, 'GET', `/v1.0/m/token/${conn.refresh_token}`);
  const expireMs = Number(top?.t ?? Date.now()) + Number(result.expireTime) * 1000;
  const next: Conn = {
    ...conn,
    access_token: String(result.accessToken),
    refresh_token: String(result.refreshToken),
    expire_at_ms: expireMs,
  };
  await sbPatch(
    'tuya_connections',
    `room_id=eq.${encodeURIComponent(conn.room_id)}`,
    {
      access_token: next.access_token,
      refresh_token: next.refresh_token,
      expire_at_ms: expireMs,
      updated_at: new Date().toISOString(),
    },
  );
  return next;
}

async function withToken(conn: Conn, fn: (c: Conn) => Promise<any>): Promise<{ conn: Conn; data: any }> {
  let cur = conn;
  if (Date.now() > Number(conn.expire_at_ms) - 60_000) cur = await refreshConn(cur);
  try {
    return { conn: cur, data: await fn(cur) };
  } catch (err) {
    if (err instanceof TuyaApiError && err.expired) {
      const renewed = await refreshConn(cur);
      return { conn: renewed, data: await fn(renewed) };
    }
    throw err;
  }
}

// ---------------------------------------------------------------- devices
const SWITCH_RE = /^switch_\d+$/;

// 맥미니가 꽂혀 있는 스마트플러그 '미니'.
// 식구들이 실수로 끄거나 '전체 소등'에 걸리면 맥미니 전원이 꺼지므로
// 목록에서 아예 빼고(list), 제어는 403으로 막고(command), 전체 소등에서도 건너뛴다(all_off).
const EXCLUDED_DEVICE_IDS = new Set(['eb1f8a6820f472f854knoa']);

function mapDevice(d: any) {
  const status: any[] = Array.isArray(d.status) ? d.status : [];
  const switches = status
    .filter((s) => SWITCH_RE.test(String(s.code)))
    .map((s) => ({ code: String(s.code), on: s.value === true }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const power = status.find((s) => s.code === 'cur_power');
  const temp = status.find((s) => s.code === 'va_temperature');
  const hum = status.find((s) => s.code === 'va_humidity');
  return {
    id: String(d.id),
    name: String(d.name ?? '').trim(),
    category: String(d.category ?? ''),
    product_name: String(d.product_name ?? ''),
    online: d.online === true,
    switches,
    power_w: power ? Math.round(Number(power.value) || 0) : null,
    temperature: temp ? Math.round((Number(temp.value) || 0) / 10) : null,
    humidity: hum ? Math.round(Number(hum.value) || 0) : null,
  };
}

async function listDevices(conn: Conn) {
  const { result } = await tuyaCall(conn, 'GET', '/v1.0/m/life/ha/home/devices', {
    homeId: conn.home_id,
  });
  const list = Array.isArray(result) ? result : [];
  return list.filter((d: any) => !EXCLUDED_DEVICE_IDS.has(String(d?.id))).map(mapDevice);
}

async function readLabels(conn: Conn): Promise<Record<string, string>> {
  const [room] = await sbSelect(
    'family_rooms',
    `select=light_labels&room_id=eq.${encodeURIComponent(conn.room_id)}`,
  );
  const roomLabels = (room?.light_labels ?? {}) as Record<string, string>;
  const fallback = (conn.switch_labels ?? {}) as Record<string, string>;
  return Object.keys(roomLabels).length ? roomLabels : fallback;
}

// ---------------------------------------------------------------- handler
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const roomCode = (req.headers.get('x-room-code') || '').trim().toLowerCase();
  if (!roomCode) return json({ error: 'x-room-code 헤더가 필요합니다.' }, 400);

  let reqBody: any = {};
  try {
    reqBody = await req.json();
  } catch {
    return json({ error: 'JSON 본문이 필요합니다.' }, 400);
  }
  const action = String(reqBody.action || 'list');

  try {
    const [conn] = await sbSelect('tuya_connections', `select=*&room_id=eq.${encodeURIComponent(roomCode)}`);
    if (!conn) return json({ connected: false, devices: [], labels: {} });
    const typed = { ...conn, expire_at_ms: Number(conn.expire_at_ms) } as Conn;

    if (action === 'list') {
      const { data } = await withToken(typed, (c) => listDevices(c));
      return json({
        connected: true,
        devices: data,
        labels: await readLabels(typed),
        fetched_at: new Date().toISOString(),
      });
    }

    if (action === 'command') {
      const deviceId = String(reqBody.device_id || '');
      const code = String(reqBody.code || '');
      const value = reqBody.value === true;
      if (!deviceId || !SWITCH_RE.test(code)) return json({ error: 'device_id/code 값이 올바르지 않습니다.' }, 400);
      if (EXCLUDED_DEVICE_IDS.has(deviceId)) {
        return json({ error: '보호된 기기라 제어할 수 없어요.' }, 403);
      }

      const { data } = await withToken(typed, async (c) => {
        const devices = await listDevices(c);
        const target = devices.find((d: any) => d.id === deviceId);
        if (!target) throw new TuyaApiError('NOT_IN_HOME', '이 집의 기기가 아닙니다.');
        if (!target.online) throw new TuyaApiError('OFFLINE', '기기가 오프라인이라 제어할 수 없습니다.');
        if (!target.switches.some((s: any) => s.code === code)) {
          throw new TuyaApiError('NO_CHANNEL', '이 기기에 없는 스위치입니다.');
        }
        await tuyaCall(c, 'POST', `/v1.1/m/thing/${encodeURIComponent(deviceId)}/commands`, undefined, {
          commands: [{ code, value }],
        });
        // 실제 반영된 상태를 다시 읽어 돌려준다
        return await listDevices(c);
      });
      return json({ connected: true, ok: true, devices: data, labels: await readLabels(typed) });
    }

    if (action === 'all_off') {
      const { data } = await withToken(typed, async (c) => {
        const devices = await listDevices(c);
        const targets = devices.filter(
          (d: any) => d.online && d.switches.length && !EXCLUDED_DEVICE_IDS.has(String(d.id)),
        );
        let changed = 0;
        for (const d of targets) {
          const on = d.switches.filter((s: any) => s.on);
          if (!on.length) continue;
          await tuyaCall(c, 'POST', `/v1.1/m/thing/${encodeURIComponent(d.id)}/commands`, undefined, {
            commands: on.map((s: any) => ({ code: s.code, value: false })),
          });
          changed += on.length;
        }
        const after = await listDevices(c);
        return { devices: after, changed };
      });
      return json({
        connected: true,
        ok: true,
        changed: data.changed,
        devices: data.devices,
        labels: await readLabels(typed),
      });
    }

    if (action === 'save_label') {
      const deviceId = String(reqBody.device_id || '');
      const code = String(reqBody.code || '');
      const label = String(reqBody.label ?? '').trim().slice(0, 20);
      if (!deviceId || !SWITCH_RE.test(code)) return json({ error: 'device_id/code 값이 올바르지 않습니다.' }, 400);

      const labels = { ...(await readLabels(typed)) };
      const key = `${deviceId}.${code}`;
      if (label) labels[key] = label;
      else delete labels[key];

      await sbPatch('family_rooms', `room_id=eq.${encodeURIComponent(roomCode)}`, { light_labels: labels });
      await sbPatch('tuya_connections', `room_id=eq.${encodeURIComponent(roomCode)}`, { switch_labels: labels });
      return json({ connected: true, ok: true, labels });
    }

    return json({ error: `알 수 없는 action: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof TuyaApiError ? err.code : 'ERROR';
    console.error('[tuya-lights]', action, code, message);
    return json({ connected: true, error: message, code }, 502);
  }
});
