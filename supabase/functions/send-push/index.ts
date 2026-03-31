// @ts-nocheck
import webpush from "https://esm.sh/web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

// Set VAPID details from environment variables
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";

webpush.setVapidDetails(
  "mailto:your-email@example.com",
  vapidPublicKey,
  vapidPrivateKey
);

export default async function (req: Request) {
  // CORS headers
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
    // Note: We use the SERVICE ROLE KEY here to forcefully check profiles and delete stale subscriptions
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    const message = body.record || body;
    
    if (!message || !message.receiver_id) {
       return new Response(JSON.stringify({ error: "No receiver_id in payload" }), { status: 400, headers });
    }

    const receiverId = message.receiver_id;

    // SMART SKIP: Check if the receiver is currently online
    const { data: receiverProfile } = await supabase
      .from("profiles")
      .select("is_online, updated_at")
      .eq("id", receiverId)
      .single();

    if (receiverProfile?.is_online) {
      console.log(`User ${receiverId} is currently online. Skipping push notification (Smart-Skip).`);
      return new Response(JSON.stringify({ success: true, message: "Skipped: Receiver is online" }), { headers });
    }

    // Get the receiver's push subscriptions
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", receiverId);

    if (error || !subscriptions || subscriptions.length === 0) {
      console.log(`No active push subscriptions found for user ${receiverId}`);
      return new Response(JSON.stringify({ success: false, message: "No subscriptions" }), { headers });
    }

    // PRIVACY-FIRST NOTIFICATION: We intentionally DO NOT send the sender_name or ciphertext. 
    // The service worker will just show "You have a new message 💌"
    const pushPayload = JSON.stringify({
      messageId: message.id,
      url: "/" 
    });

    let successCount = 0;
    
    const sendPromises = subscriptions.map(async (subRecord: any) => {
      try {
        const subscription = {
          endpoint: subRecord.endpoint,
          keys: {
            p256dh: subRecord.p256dh,
            auth: subRecord.auth
          }
        };
        await webpush.sendNotification(subscription, pushPayload);
        successCount++;
      } catch (err: any) {
         console.error("Error sending push notification using sub", err);
         if (err.statusCode === 410 || err.statusCode === 404) {
           // Subscription has expired/unsubscribed/revoked, delete it from our DB
           await supabase
             .from("push_subscriptions")
             .delete()
             .eq("endpoint", subRecord.endpoint)
             .eq("user_id", receiverId);
         }
      }
    });

    await Promise.all(sendPromises);

    return new Response(JSON.stringify({ success: true, sentTo: successCount }), { headers });

  } catch (err: any) {
    console.error("Function error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
