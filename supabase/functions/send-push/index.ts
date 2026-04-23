// @ts-nocheck
// deno-lint-ignore-file
/// <reference types="https://esm.sh/v135/@supabase/functions-js/src/edge-runtime.d.ts" />
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// ── VAPID helpers (Deno-native crypto, no npm:web-push needed) ────────────────

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function uint8ArrayToBase64Url(arr: Uint8Array): string {
  let binary = "";
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// HKDF-SHA256 extract + expand (RFC 5869)
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", salt.length ? salt : new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", key, ikm));
  const infoKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const t = new Uint8Array(await crypto.subtle.sign("HMAC", infoKey, concatUint8Arrays(info, new Uint8Array([1]))));
  return t.slice(0, length);
}

function createInfo(type: string, clientPublicKey: Uint8Array, serverPublicKey: Uint8Array): Uint8Array {
  const encoder = new TextEncoder();
  const typeBytes = encoder.encode(type);
  const header = encoder.encode("Content-Encoding: ");
  const nul = new Uint8Array([0]);

  // "Content-Encoding: <type>\0P-256\0\0A<client_key>\0A<server_key>"
  const p256 = encoder.encode("P-256");
  const clientLen = new Uint8Array([0, clientPublicKey.length]);
  const serverLen = new Uint8Array([0, serverPublicKey.length]);

  return concatUint8Arrays(
    header, typeBytes, nul,
    p256, nul,
    clientLen, clientPublicKey,
    serverLen, serverPublicKey
  );
}

async function encryptPayload(
  clientPublicKeyBytes: Uint8Array,
  clientAuthBytes: Uint8Array,
  payload: Uint8Array
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKeyBytes: Uint8Array }> {
  // Generate an ephemeral ECDH key pair
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));

  // Import client public key
  const clientPublicKey = await crypto.subtle.importKey("raw", clientPublicKeyBytes, { name: "ECDH", namedCurve: "P-256" }, false, []);

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublicKey }, serverKeys.privateKey, 256));

  // Generate random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF for auth secret
  const encoder = new TextEncoder();
  const authInfo = encoder.encode("Content-Encoding: auth\0");
  const prk = await hkdf(clientAuthBytes, sharedSecret, authInfo, 32);

  // HKDF for content encryption key
  const cekInfo = createInfo("aesgcm", clientPublicKeyBytes, serverPublicKeyRaw);
  const contentEncryptionKey = await hkdf(salt, prk, cekInfo, 16);

  // HKDF for nonce
  const nonceInfo = createInfo("nonce", clientPublicKeyBytes, serverPublicKeyRaw);
  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // Pad payload (2-byte padding length prefix + payload)
  const paddingLength = 0;
  const paddedPayload = new Uint8Array(2 + paddingLength + payload.length);
  paddedPayload[0] = (paddingLength >> 8) & 0xff;
  paddedPayload[1] = paddingLength & 0xff;
  paddedPayload.set(payload, 2 + paddingLength);

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey("raw", contentEncryptionKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, paddedPayload));

  return { ciphertext: encrypted, salt, serverPublicKeyBytes: serverPublicKeyRaw };
}

async function createVapidAuthHeader(
  audience: string,
  subject: string,
  vapidPublicKey: Uint8Array,
  vapidPrivateKey: Uint8Array
): Promise<{ authorization: string; cryptoKey: string }> {
  // JWT header + claims
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: audience, exp: now + 12 * 3600, sub: subject };

  const encodedHeader = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = uint8ArrayToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const unsignedToken = `${encodedHeader}.${encodedClaims}`;

  // Import the VAPID private key as ECDSA P-256
  // The private key is 32 bytes raw. We need to construct a JWK.
  const publicKeyUncompressed = vapidPublicKey; // 65 bytes uncompressed
  const x = uint8ArrayToBase64Url(publicKeyUncompressed.slice(1, 33));
  const y = uint8ArrayToBase64Url(publicKeyUncompressed.slice(33, 65));
  const d = uint8ArrayToBase64Url(vapidPrivateKey);

  const jwk = { kty: "EC", crv: "P-256", x, y, d };

  const signingKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, new TextEncoder().encode(unsignedToken)));

  // Convert from WebCrypto DER-ish format to raw r||s (64 bytes)
  // WebCrypto ECDSA P-256 sign returns 64 bytes (r || s) already for P-256
  const token = `${unsignedToken}.${uint8ArrayToBase64Url(signature)}`;

  const publicKeyBase64Url = uint8ArrayToBase64Url(vapidPublicKey);
  return {
    authorization: `vapid t=${token}, k=${publicKeyBase64Url}`,
    cryptoKey: `p256ecdsa=${publicKeyBase64Url}`,
  };
}

async function sendWebPush(
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  vapidPublicKey: Uint8Array,
  vapidPrivateKey: Uint8Array,
  vapidSubject: string
): Promise<Response> {
  const clientPublicKey = base64UrlToUint8Array(subscription.keys.p256dh);
  const clientAuth = base64UrlToUint8Array(subscription.keys.auth);
  const payloadBytes = new TextEncoder().encode(payload);

  const { ciphertext, salt, serverPublicKeyBytes } = await encryptPayload(clientPublicKey, clientAuth, payloadBytes);

  const endpointUrl = new URL(subscription.endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

  const vapidHeaders = await createVapidAuthHeader(audience, vapidSubject, vapidPublicKey, vapidPrivateKey);

  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aesgcm",
      "Encryption": `salt=${uint8ArrayToBase64Url(salt)}`,
      "Crypto-Key": `dh=${uint8ArrayToBase64Url(serverPublicKeyBytes)};${vapidHeaders.cryptoKey}`,
      "Authorization": vapidHeaders.authorization,
      "TTL": "86400",
      "Urgency": "high",
    },
    body: ciphertext,
  });

  return response;
}

// ── Main Edge Function ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Content-Type": "application/json",
  });

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const vapidPublicKeyStr = Deno.env.get("VAPID_PUBLIC_KEY") || "";
    const vapidPrivateKeyStr = Deno.env.get("VAPID_PRIVATE_KEY") || "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:aura-app@example.com";

    if (!vapidPublicKeyStr || !vapidPrivateKeyStr) {
      return new Response(JSON.stringify({ error: "VAPID keys not set" }), { status: 500, headers });
    }

    const vapidPublicKey = base64UrlToUint8Array(vapidPublicKeyStr);
    const vapidPrivateKey = base64UrlToUint8Array(vapidPrivateKeyStr);

    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log("[send-push] Received request body:", JSON.stringify(body));
    const message = body.record || body;


    if (!message || !message.receiver_id) {
      console.warn("[send-push] No receiver_id found in payload.");
      return new Response(JSON.stringify({ error: "No receiver_id in payload" }), { status: 400, headers });
    }

    const receiverId = message.receiver_id;
    const senderId = message.sender_id;

    // Fetch profile, subscriptions, sender profile, AND receiver's notification settings in parallel
    const [profileRes, subsRes, senderProfileRes, settingsRes] = await Promise.all([
      supabase.from("profiles").select("is_online, last_seen").eq("id", receiverId).single(),
      supabase.from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", receiverId),
      supabase.from("profiles").select("display_name").eq("id", senderId).single(),
      supabase.from("chat_settings").select("notification_alias, notification_bodies").eq("user_id", receiverId).single()
    ]);

    const receiverProfile = profileRes.data;
    const subscriptions = subsRes.data;
    const fallbackSenderName = senderProfileRes.data?.display_name || "Your partner";
    const receiverSettings = settingsRes.data;

    console.log(`[send-push] Fetched data for receiver ${receiverId}:`);
    console.log(`[send-push] - Profile is_online: ${receiverProfile?.is_online}, last_seen: ${receiverProfile?.last_seen}`);
    console.log(`[send-push] - Active push subscriptions count: ${subscriptions?.length || 0}`);
    console.log(`[send-push] - Receiver settings: alias='${receiverSettings?.notification_alias}', custom_bodies_count=${receiverSettings?.notification_bodies?.length || 0}`);

    // ── PERSONALISED SENDER NAME ──
    // Use receiver's custom alias if set, else fallback to sender's display name
    const senderName = receiverSettings?.notification_alias?.trim() || fallbackSenderName;

    // ── RANDOM NOTIFICATION BODY ──
    const DEFAULT_BODIES = [
      'Someone is thinking of you 💭',
      'A whisper has arrived for you 🤫',
      'Your sanctuary has a new message ✨',
      'Something special is waiting for you 💌',
      'A secret message has arrived 🔐',
      'You have been summoned to the sanctuary 🕯️',
      'A gentle knock on your heart 💛',
      'Love is calling you back 📱',
      'The universe sent you a signal 🌙',
      'Your world just got a little brighter ☀️',
    ];
    const bodyPool: string[] = (receiverSettings?.notification_bodies?.length ?? 0) >= 1
      ? receiverSettings!.notification_bodies as string[]
      : DEFAULT_BODIES;
    const randomBody = bodyPool[Math.floor(Math.random() * bodyPool.length)];

    // SMART SKIP: Check if user is actively online
    if (receiverProfile?.is_online) {
      const lastSeen = receiverProfile.last_seen ? new Date(receiverProfile.last_seen).getTime() : 0;
      const secondsSinceLastSeen = (Date.now() - lastSeen) / 1000;
      
      console.log(`[send-push] Smart skip evaluation: user is marked online. Seconds since last seen: ${secondsSinceLastSeen}s (Threshold is 20s)`);
      
      // If user is marked is_online=true AND pinged within the last 20 seconds, they are actively online.
      if (secondsSinceLastSeen < 20) {
        console.log(`[send-push] 🛑 Skipping push notification because receiver is actively online (${secondsSinceLastSeen}s < 20s)`);
        return new Response(JSON.stringify({ success: true, message: "Skipped - User is active" }), { headers });
      } else {
        console.log(`[send-push] ✅ Proceeding with push notification despite is_online=true, because last_seen is stale (${secondsSinceLastSeen}s >= 20s)`);
      }
    } else {
      console.log("[send-push] ✅ Proceeding with push notification because receiver is offline (is_online=false).");
    }

    if (subsRes.error || !subscriptions || subscriptions.length === 0) {
      console.warn(`[send-push] ❌ Cannot send push: No active subscriptions found for receiver ${receiverId}.`);
      return new Response(JSON.stringify({ success: false, message: "No subscriptions" }), { headers });
    }



    // Send personalized payload so the service worker can display meaningful content
    const pushPayload = JSON.stringify({
      messageId: message.id,
      senderId: senderId,
      senderName: senderName,
      body: randomBody,
      url: "/",
    });

    let successCount = 0;

    const sendPromises = subscriptions.map(async (sub: any) => {
      try {
        const response = await sendWebPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          pushPayload,
          vapidPublicKey,
          vapidPrivateKey,
          vapidSubject
        );



        if (response.status === 201 || response.status === 200) {
          console.log(`[send-push] ✅ Push successfully delivered to endpoint: ${sub.endpoint}`);
          successCount++;
        } else if (response.status === 410 || response.status === 404 || response.status === 400) {
          console.warn(`[send-push] ⚠️ Subscription invalid or expired (status ${response.status}) for endpoint: ${sub.endpoint}. Deleting from database.`);
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", receiverId);
        } else {
          const respBody = await response.text();
          console.error(`[send-push] ❌ Failed to deliver push to endpoint: ${sub.endpoint}. Status: ${response.status}, Response: ${respBody}`);
        }
      } catch (err: any) {
        console.error(`[send-push] ❌ Exception while sending to endpoint: ${sub.endpoint}:`, err.message);
        // failed silently
      }
    });

    await Promise.all(sendPromises);

    console.log(`[send-push] 🎉 Notification delivery completed. Successfully sent to ${successCount}/${subscriptions.length} devices.`);
    return new Response(JSON.stringify({ success: true, sentTo: successCount }), { headers });

  } catch (err: any) {
    console.error("[send-push] Fatal error:", err.message, err.stack);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
});
