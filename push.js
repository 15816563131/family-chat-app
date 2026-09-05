// push.js —— 浏览器端 Web Push（VAPID），无需自有服务器。
// 发送方用这些密钥直接把通知推给接收方的浏览器推送端点。
const VAPID_JWK = {
  kty: "EC", crv: "P-256",
  x: "pwOxVYQNGmZbSyoRJC8cXHJ3zSLN548X_-8aZUvwUQ4",
  y: "dCclQroxkImtddndFnx0iZQKQdBC4KyKqq6j7U47qIQ",
  d: "Q5RSHbRprP7pB0jAwbDGfbP7rqSAE1eCFW6mZSuhGLQ"
};
const VAPID_PUB_RAW = "BKcDsVWEDRpmW0sqESQvHFxyd80izeePF__vGmVL8FEOdCclQroxkImtddndFnx0iZQKQdBC4KyKqq6j7U47qIQ";

function b64urlToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const b = atob(s + pad);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}
function bytesToB64url(b) {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(keyBytes, data) {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
function concat(...arrs) {
  let n = 0; arrs.forEach(a => (n += a.length));
  const out = new Uint8Array(n);
  let o = 0;
  arrs.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}
async function hkdf(salt, ikm, info, length) {
  // HKDF: extract = HMAC(salt, ikm); expand with info + counter
  const prk = await hmac(salt, ikm);
  let cur = new Uint8Array(0);
  const out = new Uint8Array(length);
  for (let i = 1; i <= Math.ceil(length / 32); i++) {
    cur = await hmac(prk, concat(cur, info, new Uint8Array([i])));
    out.set(cur, (i - 1) * 32);
  }
  return out;
}
async function ecdh(receiverPubRaw, privJwk) {
  const recvKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: bytesToB64url(receiverPubRaw.slice(1, 33)), y: bytesToB64url(receiverPubRaw.slice(33, 65)) },
    { name: "ECDH" }, false, []
  );
  const myPriv = await crypto.subtle.importKey("jwk", privJwk, { name: "ECDH" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: recvKey }, myPriv, 256);
  return new Uint8Array(bits);
}
function derToRaw(der) {
  let off = 2; // skip SEQUENCE + length (assume short form)
  off++; const rLen = der[off + 1]; const r = der.slice(off + 2, off + 2 + rLen);
  off = off + 2 + rLen; off++; const sLen = der[off + 1]; const s = der.slice(off + 2, off + 2 + sLen);
  const fix = v => { if (v.length < 32) { const t = new Uint8Array(32); t.set(v, 32 - v.length); return t; } return v; };
  return concat(fix(r), fix(s));
}
async function signJwt(payloadObj) {
  const enc = new TextEncoder();
  const h = bytesToB64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const p = bytesToB64url(enc.encode(JSON.stringify(payloadObj)));
  const data = h + "." + p;
  const key = await crypto.subtle.importKey("jwk", VAPID_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sigDer = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(data)));
  return data + "." + bytesToB64url(derToRaw(sigDer));
}

async function encrypt(sub, payloadObj) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const subPub = b64urlToBytes(sub.keys.p256dh);
  const auth = b64urlToBytes(sub.keys.auth);
  const shared = await ecdh(subPub, VAPID_JWK);
  const ctx = concat(
    enc.encode("WebPush: content-encoding: aes128gcm"),
    new Uint8Array([0]), subPub, new Uint8Array([0]), b64urlToBytes(VAPID_PUB_RAW)
  );
  const ck = await hkdf(auth, shared, ctx, 32);
  const cek = ck.slice(0, 16), nonce = ck.slice(16, 32);
  const plain = concat(enc.encode(JSON.stringify(payloadObj)), new Uint8Array([0, 0]));
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain));
  return { body: concat(salt, ct), salt };
}

async function sendPush(sub, payloadObj) {
  const { body, salt } = await encrypt(sub, payloadObj);
  const aud = new URL(sub.endpoint).origin;
  const jwt = await signJwt({ aud, exp: Math.floor(Date.now() / 1000) + 86400, sub: "mailto:familychat@example.com" });
  await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Encryption": "salt=" + bytesToB64url(salt),
      "Crypto-Key": "dh=" + VAPID_PUB_RAW,
      "TTL": "2419200",
      "Authorization": "WebPush " + jwt
    },
    body
  });
}

async function subscribePush() {
  if (!("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(VAPID_PUB_RAW) });
  return sub.toJSON();
}
window.FC_PUSH = { subscribePush, sendPush };
