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
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body = await req.json();
    console.log("Received webhook payload:", body);

    // If triggered by a database webhook on insertion to "messages"
    const message = body.record || body;
    
    if (!message || !message.receiver_id) {
       return new Response(JSON.stringify({ error: "No receiver_id in payload" }), { status: 400, headers });
    }

    const receiverId = message.receiver_id;
    const senderId = message.sender_id;

    // Get the sender's details for the notification title
    const { data: sender } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", senderId)
      .single();

    const senderName = sender?.display_name || "Someone";

    // Get the receiver's push subscriptions
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", receiverId);

    if (error || !subscriptions || subscriptions.length === 0) {
      console.log(`No active push subscriptions found for user ${receiverId}`);
      return new Response(JSON.stringify({ success: false, message: "No subscriptions" }), { headers });
    }

    // Since it's E2EE, we send the ciphertext to the service worker to decrypt locally
    const pushPayload = JSON.stringify({
      title: `Secure message from ${senderName}`,
      body: "You have a new encrypted message",
      messageId: message.id,
      ciphertext: message.encrypted_content || message.ciphertext,
      nonce: message.nonce,
      senderId: senderId,
      url: "/" // The URL the user should be taken to when clicking the notification
    });

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
        console.log("Push notification sent successfully");
      } catch (err: any) {
         console.error("Error sending push notification to a subscription", err);
         if (err.statusCode === 410 || err.statusCode === 404) {
           // Subscription has expired or is no longer valid, we should delete it
           await supabase
             .from("push_subscriptions")
             .delete()
             .eq("user_id", receiverId);
         }
      }
    });

    await Promise.all(sendPromises);

    return new Response(JSON.stringify({ success: true, count: subscriptions.length }), { headers });

  } catch (err: any) {
    console.error("Function error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
}
