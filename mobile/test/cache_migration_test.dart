import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';
import 'package:planner/cache.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('version 1 cache upgrades without losing pending edits or cards', () async {
    sqfliteFfiInit();
    final dir = await Directory.systemTemp.createTemp(
      'planner-cache-migration-',
    );
    final path = p.join(dir.path, 'cache.db');
    try {
      final old = await databaseFactoryFfi.openDatabase(
        path,
        options: OpenDatabaseOptions(
          version: 1,
          onCreate: (db, _) async {
            await db.execute(
              "CREATE TABLE cards (id TEXT PRIMARY KEY, day TEXT NOT NULL, sort_index REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', json TEXT NOT NULL)",
            );
            await db.execute(
              'CREATE TABLE queue (id INTEGER PRIMARY KEY AUTOINCREMENT, method TEXT NOT NULL, path TEXT NOT NULL, body TEXT, created_at TEXT NOT NULL)',
            );
            await db.execute(
              'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
            );
          },
        ),
      );
      await old.insert('queue', {
        'method': 'PATCH',
        'path': '/cards/card-1',
        'body': jsonEncode({'title': 'Pending'}),
        'created_at': '2026-09-30',
      });
      await old.insert('cards', {
        'id': 'card-1',
        'day': '2026-09-30',
        'json': jsonEncode({
          'id': 'card-1',
          'day': '2026-09-30',
          'title': 'Pending',
        }),
      });
      await old.insert('meta', {
        'key': 'last_sync',
        'value': '2026-09-30T08:00:00.000Z',
      });
      await old.close();
      await Cache.useForTesting(path: path);
      expect(
        await Cache.instance.lastSync,
        isNull,
        reason: 'upgrade refetches creator IDs and reminder settings',
      );
      final pending = (await Cache.instance.pending()).single;
      expect(pending.body!['title'], 'Pending');
      expect(pending.baseCard, isNull);
      expect(pending.failure, isNull);
      expect(
        (await Cache.instance.cardsBetween(
          '2026-09-30',
          '2026-09-30',
        )).single.title,
        'Pending',
      );
      await Cache.instance.recordFailure(pending.id, {'error': 'unavailable'});
      await Cache.useForTesting(path: path);
      expect(
        (await Cache.instance.pending()).single.failure!['error'],
        'unavailable',
      );
    } finally {
      await Cache.useInMemory();
      await dir.delete(recursive: true);
    }
  });
}
