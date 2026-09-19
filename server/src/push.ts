import * as webPush from 'web-push';
import { config } from './config.ts';
import type { Db } from './db.ts';
import type { CardRow, PushSubscriptionRow } from './types.ts';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushResult {
  sent: number;
  failed: number;
  removed: number;
  subscriptions: number;
  disabled?: true;
}

if (config.webPushEnabled) {
  webPush.setVapidDetails(
    config.webPush.subject,
    config.webPush.publicKey,
    config.webPush.privateKey,
  );
}

export const reminderPushPayload = (
  card: Pick<CardRow, 'id' | 'board_id' | 'title' | 'day' | 'start_time'>,
  offsetLabel: string,
): PushPayload => ({
  title: `Easy Plan · ${offsetLabel}`,
  body: card.title || 'Başlıksız kart',
  url: `/?card=${encodeURIComponent(card.id)}&day=${encodeURIComponent(card.day)}&board=${encodeURIComponent(card.board_id)}`,
  tag: `card-reminder-${card.id}`,
});

type PushSender = typeof webPush.sendNotification;

export async function sendPushToUser(
  database: Db,
  userId: string,
  payload: PushPayload,
  options: { enabled?: boolean; send?: PushSender } = {},
): Promise<PushResult> {
  if (!(options.enabled ?? config.webPushEnabled)) {
    return { sent: 0, failed: 0, removed: 0, subscriptions: 0, disabled: true };
  }
  const send = options.send ?? webPush.sendNotification;

  const subscriptions = database
    .prepare('SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
    .all(userId) as unknown as PushSubscriptionRow[];
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const subscription of subscriptions) {
    try {
      await send(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 },
      );
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        database.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(subscription.id);
        removed += 1;
      } else {
        failed += 1;
      }
    }
  }

  return { sent, failed, removed, subscriptions: subscriptions.length };
}
