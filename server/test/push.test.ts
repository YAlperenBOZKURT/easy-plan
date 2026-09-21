import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { reminderPushPayload, sendPushToUser } from '../src/push.ts';

const insertUser = (database: ReturnType<typeof openDb>, id: string) => {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO users
       (id, email, name, password_hash, role, timezone, daily_summary,
        last_summary_day, active, last_login_at, created_at, updated_at)
     VALUES (?, ?, '', 'x', 'user', 'Europe/Istanbul', 1, NULL, 1, NULL, ?, ?)`,
  ).run(id, `${id}@example.com`, now, now);
};

const insertSubscription = (
  database: ReturnType<typeof openDb>,
  id: string,
  userId: string,
  endpoint: string,
) => {
  const now = new Date().toISOString();
  database.prepare(
    `INSERT INTO push_subscriptions
       (id, user_id, endpoint, p256dh, auth, user_agent, created_at, updated_at)
     VALUES (?, ?, ?, 'public-key', 'auth-secret', 'test', ?, ?)`,
  ).run(id, userId, endpoint, now, now);
};

test('web push tüm kullanıcı aboneliklerine gönderilir ve süresi dolan abonelik temizlenir', async () => {
  const database = openDb(':memory:');
  insertUser(database, 'push-user');
  insertSubscription(database, 'active-sub', 'push-user', 'https://push.example/active');
  insertSubscription(database, 'expired-sub', 'push-user', 'https://push.example/expired');

  const endpoints: string[] = [];
  const result = await sendPushToUser(
    database,
    'push-user',
    { title: 'Hatırlatma', body: 'Toplantı', url: '/', tag: 'card-1' },
    {
      enabled: true,
      send: async (subscription) => {
        endpoints.push(subscription.endpoint);
        if (subscription.endpoint.endsWith('/expired')) {
          throw Object.assign(new Error('gone'), { statusCode: 410 });
        }
        return { statusCode: 201, body: '', headers: {} };
      },
    },
  );

  assert.deepEqual(endpoints, ['https://push.example/active', 'https://push.example/expired']);
  assert.deepEqual(result, { sent: 1, failed: 0, removed: 1, subscriptions: 2 });
  assert.equal(
    (database.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get() as { count: number }).count,
    1,
  );
  database.close();
});

test('hatırlatma push içeriği karta geri dönüş bilgisini taşır', () => {
  assert.deepEqual(
    reminderPushPayload(
      {
        id: 'card/1', board_id: 'board/1', title: 'Proje toplantısı',
        day: '2026-09-20', start_time: '10:00',
      },
      '1 saat kaldı',
    ),
    {
      title: 'Easy Plan · 1 saat kaldı',
      body: 'Proje toplantısı',
      url: '/?card=card%2F1&day=2026-09-20&board=board%2F1',
      tag: 'card-reminder-card/1',
    },
  );
});
