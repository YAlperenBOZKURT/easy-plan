import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

const dataDir = mkdtempSync(join(tmpdir(), 'planner-account-deletion-'));
Object.assign(process.env, {
  DATA_DIR: dataDir, NODE_ENV: 'test', SMTP_HOST: '', VAPID_PUBLIC_KEY: '',
});
const [{ buildServer }, { createUser, createSession }, { db, closeDb }, { today }] = await Promise.all([
  import('../src/index.ts'), import('../src/auth.ts'), import('../src/db.ts'), import('../src/time.ts'),
]);
after(() => {
  closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});

for (const deletedRole of ['owner', 'editor'] as const) {
  test(`deleting a board ${deletedRole} preserves other users' image references and cleans cascaded files`, async (t) => {
    const app = await buildServer({ logger: false, docs: false });
    t.after(() => app.close());
    const user = (name: string, role: 'admin' | 'user' = 'user') => {
      const created = createUser({
        email: `${deletedRole}-${name}@example.test`, password: 'account deletion test password', role,
      });
      return { ...created, authorization: `Bearer ${createSession(app, created.id).accessToken}` };
    };
    const admin = user('admin', 'admin');
    const target = user('target');
    const survivor = user('survivor');
    const outsider = user('outsider');
    const owner = deletedRole === 'owner' ? target : survivor;
    const member = deletedRole === 'owner' ? survivor : target;
    const boardResponse = await app.inject({
      method: 'POST', url: '/api/v1/boards', headers: { authorization: owner.authorization },
      payload: { name: 'Shared images' },
    });
    assert.equal(boardResponse.statusCode, 201, boardResponse.body);
    const boardId = boardResponse.json().board.id as string;
    const added = await app.inject({
      method: 'POST', url: `/api/v1/boards/${boardId}/members`,
      headers: { authorization: owner.authorization }, payload: { email: member.email, role: 'editor' },
    });
    assert.equal(added.statusCode, 201, added.body);
    const day = today(target.timezone);
    const sharedHeaders = (authorization: string) => ({ authorization, 'x-board-id': boardId });
    async function card(authorization: string, shared = false) {
      const response = await app.inject({
        method: 'POST', url: '/api/v1/cards',
        headers: shared ? sharedHeaders(authorization) : { authorization },
        payload: { day, title: 'Image lifecycle' },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().card.id as string;
    }
    type Image = { id: string; url: string; thumbUrl: string };
    async function upload(
      id: string, authorization: string, shared = false, resource = 'cards',
    ): Promise<Image> {
      const boundary = 'account-deletion-image';
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
      const response = await app.inject({
        method: 'POST', url: `/api/v1/${resource}/${id}/images`,
        headers: {
          ...(shared ? sharedHeaders(authorization) : { authorization }),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`),
          png, Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().images[0] as Image;
    }
    const fileExists = (url: string) => existsSync(join(dataDir, url.replace(/^\//, '')));
    async function assertReadable(image: Image) {
      for (const url of [image.url, image.thumbUrl]) {
        const allowed = await app.inject({ url, headers: { authorization: survivor.authorization } });
        assert.equal(allowed.statusCode, 200, allowed.body);
        assert.equal(fileExists(url), true, url);
        const forbidden = await app.inject({ url, headers: { authorization: outsider.authorization } });
        assert.equal(forbidden.statusCode, 403);
      }
    }

    const sourceId = await card(target.authorization, true);
    // Retain one file through only a template, and another through only a personal card.
    const templateImage = await upload(sourceId, target.authorization, true);
    const cardImage = await upload(sourceId, target.authorization, true);
    const templateResponse = await app.inject({
      method: 'POST', url: `/api/v1/cards/${sourceId}/template`,
      headers: sharedHeaders(survivor.authorization), payload: { name: 'Retained images' },
    });
    assert.equal(templateResponse.statusCode, 201, templateResponse.body);
    const template = templateResponse.json().template;
    const copied = await app.inject({
      method: 'POST', url: `/api/v1/card-templates/${template.id}/create-card`,
      headers: { authorization: survivor.authorization }, payload: { day },
    });
    assert.equal(copied.statusCode, 201, copied.body);
    // Detach the personal copy before editing the template's image list.
    const detached = await app.inject({
      method: 'PATCH', url: `/api/v1/cards/${copied.json().card.id}`,
      headers: { authorization: survivor.authorization }, payload: { title: 'Independent copy' },
    });
    assert.equal(detached.statusCode, 200, detached.body);
    const removedFromCard = await app.inject({
      method: 'DELETE', url: `/api/v1/images/${copied.json().card.images[0].id}`,
      headers: { authorization: survivor.authorization },
    });
    assert.equal(removedFromCard.statusCode, 200, removedFromCard.body);
    const removedFromTemplate = await app.inject({
      method: 'DELETE', url: `/api/v1/card-template-images/${template.images[1].id}`,
      headers: { authorization: survivor.authorization },
    });
    assert.equal(removedFromTemplate.statusCode, 200, removedFromTemplate.body);

    const privateId = await card(target.authorization);
    const privateImage = await upload(privateId, target.authorization);
    const privateTemplate = await app.inject({
      method: 'POST', url: '/api/v1/card-templates',
      headers: { authorization: target.authorization }, payload: { name: 'Deleted private template' },
    });
    assert.equal(privateTemplate.statusCode, 201, privateTemplate.body);
    const privateTemplateImage = await upload(
      privateTemplate.json().template.id, target.authorization, false, 'card-templates',
    );
    const sharedOrphan = await upload(sourceId, target.authorization, true);
    const unaffectedId = await card(survivor.authorization);
    const unaffected = await upload(unaffectedId, survivor.authorization);
    const memberCardId = await card(survivor.authorization, true);
    const memberImage = await upload(memberCardId, survivor.authorization, true);
    const targetUploadOnMemberCard = await upload(memberCardId, target.authorization, true);
    // This file is outside the deleted account's upload folder, but the card is cascaded.
    const otherUploader = await upload(sourceId, survivor.authorization, true);
    await assertReadable(templateImage);
    await assertReadable(cardImage);

    const deletion = await app.inject({
      method: 'DELETE', url: `/api/v1/admin/users/${target.id}`,
      headers: { authorization: admin.authorization },
    });
    assert.equal(deletion.statusCode, 200, deletion.body);
    assert.equal(db().prepare('SELECT 1 FROM users WHERE id = ?').get(target.id), undefined);
    assert.equal(db().prepare('SELECT 1 FROM cards WHERE id = ?').get(sourceId), undefined);
    await assertReadable(templateImage);
    await assertReadable(cardImage);
    await assertReadable(unaffected);
    for (const image of [privateImage, privateTemplateImage, sharedOrphan, otherUploader]) {
      assert.equal(fileExists(image.url), false, image.url);
      assert.equal(fileExists(image.thumbUrl), false, image.thumbUrl);
    }
    // An owned board cascades another member's cards. Removing only an editor
    // leaves that member's card and upload intact, but removes the editor's upload.
    assert.equal(
      Boolean(db().prepare('SELECT 1 FROM cards WHERE id = ?').get(memberCardId)),
      deletedRole === 'editor',
    );
    assert.equal(fileExists(memberImage.url), deletedRole === 'editor');
    assert.equal(fileExists(memberImage.thumbUrl), deletedRole === 'editor');
    assert.equal(fileExists(targetUploadOnMemberCard.url), false);
    assert.equal(fileExists(targetUploadOnMemberCard.thumbUrl), false);

    // Preserved files still participate in normal reference-counted deletion.
    const deleteTemplate = await app.inject({
      method: 'DELETE', url: `/api/v1/card-templates/${template.id}`,
      headers: { authorization: survivor.authorization },
    });
    assert.equal(deleteTemplate.statusCode, 200, deleteTemplate.body);
    assert.equal(fileExists(templateImage.url), false);
    assert.equal(fileExists(templateImage.thumbUrl), false);
    await assertReadable(cardImage);
    const deleteImage = await app.inject({
      method: 'DELETE', url: `/api/v1/images/${copied.json().card.images[1].id}`,
      headers: { authorization: survivor.authorization },
    });
    assert.equal(deleteImage.statusCode, 200, deleteImage.body);
    assert.equal(fileExists(cardImage.url), false);
    assert.equal(fileExists(cardImage.thumbUrl), false);
  });
}
