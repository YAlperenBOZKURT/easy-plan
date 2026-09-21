import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './pushNotifications.ts';

describe('web push helpers', () => {
  it('URL-safe VAPID anahtarını PushManager için byte dizisine çevirir', () => {
    expect([...urlBase64ToUint8Array('SGVsbG8td29ybGQ')]).toEqual([
      72, 101, 108, 108, 111, 45, 119, 111, 114, 108, 100,
    ]);
  });
});
