import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildServer } from '../src/index.ts';

test('HTTP yüzeyi sağlık, hata ve OpenAPI sözleşmesini korur', async (t) => {
  const app = await buildServer({ logger: false, docs: true });
  await app.ready();
  t.after(() => app.close());

  await t.test('health endpoint izlenebilir ve request id taşır', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'test-request-123' },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['x-request-id'], 'test-request-123');
    assert.equal(response.json().status, 'ok');
    assert.equal(typeof response.json().uptimeSeconds, 'number');
  });

  await t.test('korumalı endpoint standart 401 döndürür', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { error: 'unauthorized' });
    assert.match(String(response.headers['www-authenticate']), /^Bearer /);
    assert.equal(typeof response.headers['x-request-id'], 'string');
  });

  await t.test('bilinmeyen API endpointi izlenebilir 404 döndürür', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'not_found');
    assert.equal(response.json().requestId, response.headers['x-request-id']);
  });

  await t.test('OpenAPI belgesi ana endpointleri, zorunlu alanları ve JWT auth yöntemlerini içerir', async () => {
    const response = await app.inject({ method: 'GET', url: '/documentation/json' });
    assert.equal(response.statusCode, 200);
    const document = response.json();
    assert.equal(document.openapi, '3.0.3');
    assert.ok(document.paths['/api/v1/cards']?.get);
    assert.ok(document.paths['/api/v1/boards']?.get);
    assert.deepEqual(
      document.paths['/api/v1/boards/{id}/members'].post.requestBody.content['application/json'].schema.properties.role.enum,
      ['editor', 'viewer'],
    );
    assert.ok(document.paths['/api/v1/auth/token']?.post?.requestBody);
    assert.equal(document.paths['/api/v1/cards']?.get?.operationId, 'get_cards');
    assert.ok(document.paths['/api/v1/auth/refresh']?.post);
    assert.equal(
      document.paths['/api/v1/cards'].post.requestBody.content['application/json'].schema.properties.checklist.maxItems,
      50,
    );
    assert.deepEqual(
      document.paths['/api/v1/cards'].post.requestBody.content['application/json'].schema.properties.priority.enum,
      ['none', 'low', 'medium', 'high', 'urgent'],
    );
    assert.equal(
      document.paths['/api/v1/cards'].post.requestBody.content['application/json'].schema.properties.deadlineAt.anyOf[0].format,
      'date-time',
    );
    assert.equal(
      document.paths['/api/v1/cards'].post.requestBody.content['application/json'].schema.properties.tags.maxItems,
      10,
    );
    assert.equal(
      document.paths['/api/v1/cards'].post.requestBody.content['application/json'].schema.properties.templateId.format,
      'uuid',
    );
    assert.ok(document.paths['/api/v1/tags']?.get);
    assert.ok(document.paths['/api/v1/cards/archived']?.get);
    assert.ok(document.paths['/api/v1/cards/trash']?.get);
    assert.ok(document.paths['/api/v1/cards/{id}/archive']?.post);
    assert.ok(document.paths['/api/v1/cards/{id}/restore']?.post);
    assert.ok(document.paths['/api/v1/cards/{id}/permanent']?.delete);
    assert.ok(document.paths['/api/v1/cards/{id}/duplicate']?.post);
    assert.ok(document.paths['/api/v1/cards/{id}/template']?.post);
    assert.ok(document.paths['/api/v1/card-templates']?.get);
    assert.ok(document.paths['/api/v1/card-templates']?.post);
    assert.ok(document.paths['/api/v1/card-templates/{id}']?.patch);
    assert.ok(document.paths['/api/v1/card-templates/{id}/create-card']?.post);
    assert.ok(document.paths['/api/v1/card-templates/{id}/images']?.post);
    assert.ok(document.paths['/api/v1/card-template-images/{id}']?.delete);
    assert.deepEqual(
      document.paths['/api/v1/data/export'].get.parameters.find(
        (parameter: { name: string }) => parameter.name === 'format',
      ).schema.enum,
      ['json', 'csv', 'ics'],
    );
    assert.ok(document.paths['/api/v1/data/import']?.post);
    assert.equal(
      document.paths['/api/v1/cards/search'].get.parameters.find(
        (parameter: { name: string }) => parameter.name === 'q',
      ).schema.minLength,
      2,
    );
    assert.deepEqual(
      document.paths['/api/v1/auth/token'].post.requestBody.content['application/json'].schema.required,
      ['email', 'password'],
    );
    assert.ok(document.components.securitySchemes.accessCookie);
    assert.ok(document.components.securitySchemes.refreshCookie);
    assert.ok(document.components.securitySchemes.bearerAuth);
    assert.ok(document.components.securitySchemes.refreshBearer);
  });
});
