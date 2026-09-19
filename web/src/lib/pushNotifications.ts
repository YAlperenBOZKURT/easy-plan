import { api, type PushConfig } from './api.ts';

export type PushStatus =
  | 'unsupported'
  | 'server-disabled'
  | 'denied'
  | 'enabled'
  | 'disabled';

export interface BrowserPushState {
  status: PushStatus;
  config: PushConfig;
}

const supported = () =>
  window.isSecureContext &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

export async function browserPushState(): Promise<BrowserPushState> {
  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey) return { status: 'server-disabled', config };
  if (!supported()) return { status: 'unsupported', config };
  if (Notification.permission === 'denied') return { status: 'denied', config };

  const current = await (await registration()).pushManager.getSubscription();
  return { status: current ? 'enabled' : 'disabled', config };
}

export async function enableBrowserPush(): Promise<void> {
  if (!supported()) throw new Error('push_unsupported');
  const config = await api.pushConfig();
  if (!config.enabled || !config.publicKey) throw new Error('push_disabled');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('push_denied');

  const worker = await registration();
  const subscription = await worker.pushManager.getSubscription() ?? await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(config.publicKey),
  });
  const serialized = subscription.toJSON();
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) {
    await subscription.unsubscribe();
    throw new Error('invalid_subscription');
  }
  await api.subscribePush({
    endpoint: serialized.endpoint,
    keys: { p256dh: serialized.keys.p256dh, auth: serialized.keys.auth },
  });
}

export async function disableBrowserPush(): Promise<void> {
  if (!supported()) return;
  const current = await (await registration()).pushManager.getSubscription();
  if (!current) return;
  await api.unsubscribePush(current.endpoint);
  await current.unsubscribe();
}
