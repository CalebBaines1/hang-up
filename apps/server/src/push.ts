import webpush from "web-push";
import { config } from "./config.ts";
import { getMeta, setMeta } from "./db.ts";
import { deletePushSub, pushSubs } from "./store.ts";

let keys = config.vapid.publicKey && config.vapid.privateKey ? { publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey } : null;
if (!keys) {
  const stored = getMeta("vapid");
  keys = stored ? JSON.parse(stored) : webpush.generateVAPIDKeys();
  if (!stored) setMeta("vapid", JSON.stringify(keys));
}
webpush.setVapidDetails(config.vapid.subject, keys!.publicKey, keys!.privateKey);

export const vapidPublicKey = keys!.publicKey;

export async function pushToDevice(deviceId: string, payload: Record<string, unknown>) {
  for (const { endpoint, sub } of pushSubs(deviceId)) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 600, urgency: "high" });
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) deletePushSub(endpoint);
      else console.error("push failed", err?.statusCode ?? err);
    }
  }
}
