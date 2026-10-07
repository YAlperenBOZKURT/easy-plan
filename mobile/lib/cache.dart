import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb, visibleForTesting;
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'api/models.dart';
import 'app_logger.dart';
import 'search.dart';
import 'tags.dart';
import 'sync_queue.dart';
import 'reminder_schedule.dart';

/// Yerel kopya ve çevrimdışı yazma kuyruğu.
///
/// Uygulama açılışta önce buradan okur (internet olmasa da takvim görünür),
/// sonra sunucudan delta senkron yapar. Çevrimdışıyken yapılan değişiklikler
/// kuyruğa yazılır ve bağlantı gelince sırayla gönderilir.
class Cache {
  Cache._();
  static final instance = Cache._();

  Database? _db;
  bool _initFailed = false;

  Future<Database?> _open() async {
    if (_db != null) return _db;
    if (_initFailed || kIsWeb) return null;
    try {
      // Masaüstünde sqflite yerine FFI sürücüsü kullanılır.
      if (Platform.isWindows || Platform.isLinux || Platform.isMacOS) {
        sqfliteFfiInit();
        databaseFactory = databaseFactoryFfi;
      }
      final dir = await getDatabasesPath();
      _db = await _openAt(p.join(dir, 'planner_cache.db'));
      return _db;
    } catch (error, stack) {
      AppLogger.error('cache_open_failed', error, stack);
      _initFailed = true;
      return null;
    }
  }

  Future<Database> _openAt(String path) => openDatabase(
    path,
    version: 3,
    onUpgrade: (db, oldVersion, _) async {
      if (oldVersion < 2) {
        await db.execute('ALTER TABLE queue ADD COLUMN base_card TEXT');
        await db.execute('ALTER TABLE queue ADD COLUMN failure TEXT');
      }
      if (oldVersion < 3) {
        // Fetch creator IDs and authoritative reminder settings on upgrade.
        await db.delete('meta', where: 'key = ?', whereArgs: ['last_sync']);
      }
    },
    onCreate: (db, _) async {
      await db.execute('''
            CREATE TABLE cards (
              id TEXT PRIMARY KEY,
              day TEXT NOT NULL,
              sort_index REAL NOT NULL DEFAULT 0,
              updated_at TEXT NOT NULL DEFAULT '',
              json TEXT NOT NULL
            )
          ''');
      await db.execute('CREATE INDEX idx_cards_day ON cards(day)');
      // Çevrimdışı yapılan yazmalar: sırayla tekrar gönderilir.
      await db.execute('''
            CREATE TABLE queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              method TEXT NOT NULL,
              path TEXT NOT NULL,
              body TEXT,
              base_card TEXT,
              failure TEXT,
              created_at TEXT NOT NULL
            )
          ''');
      await db.execute(
        'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
      );
    },
  );

  /* ------------------------------------------------------------- kartlar */

  Future<void> saveCards(Iterable<PlannerCard> cards) async {
    final db = await _open();
    if (db == null) return;
    final batch = db.batch();
    for (final card in cards) {
      batch.insert('cards', {
        'id': card.id,
        'day': card.day,
        'sort_index': card.sortIndex,
        'updated_at': card.updatedAt,
        'json': jsonEncode(card.toJson()),
      }, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    await batch.commit(noResult: true);
  }

  /// Sunucu kopyası ve senkron imleci yalnızca kuyruk boşken birlikte uygulanır.
  /// Kontrol ve yazmalar aynı transaction'dadır; yeni bir yerel yazma araya
  /// girip henüz gönderilmemiş kartın eski sunucu sürümüyle ezilmesine yol açmaz.
  Future<bool> applyServerChanges(
    Iterable<PlannerCard> cards, {
    Iterable<String> deletions = const [],
    String? serverTime,
    ReminderSettings? reminderSettings,
    bool replaceAll = false,
  }) async {
    final db = await _open();
    if (db == null) return true;
    return db.transaction((transaction) async {
      final pending = await transaction.rawQuery(
        'SELECT COUNT(*) AS n FROM queue',
      );
      if ((pending.first['n'] as int) > 0) return false;
      final batch = transaction.batch();
      if (replaceAll) batch.delete('cards');
      for (final card in cards) {
        batch.insert('cards', {
          'id': card.id,
          'day': card.day,
          'sort_index': card.sortIndex,
          'updated_at': card.updatedAt,
          'json': jsonEncode(card.toJson()),
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      for (final id in deletions) {
        batch.delete('cards', where: 'id = ?', whereArgs: [id]);
      }
      if (serverTime != null) {
        batch.insert('meta', {
          'key': 'last_sync',
          'value': serverTime,
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      if (reminderSettings != null) {
        batch.insert('meta', {
          'key': 'reminder_settings',
          'value': jsonEncode(reminderSettings.toJson()),
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
      await batch.commit(noResult: true);
      return true;
    });
  }

  Future<void> removeCards(Iterable<String> ids) async {
    final db = await _open();
    if (db == null || ids.isEmpty) return;
    final batch = db.batch();
    for (final id in ids) {
      batch.delete('cards', where: 'id = ?', whereArgs: [id]);
    }
    await batch.commit(noResult: true);
  }

  Future<List<PlannerCard>> cardsBetween(String from, String to) async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query(
      'cards',
      where: 'day >= ? AND day <= ?',
      whereArgs: [from, to],
      orderBy: 'day, sort_index',
    );
    return rows
        .map(
          (row) => PlannerCard.fromJson(
            jsonDecode(row['json']! as String) as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  /// The settings and all cached cards are read together, outside viewport bounds.
  Future<({ReminderSettings? settings, List<PlannerCard> cards})>
  reminderSnapshot() async {
    final db = await _open();
    if (db == null) return (settings: null, cards: <PlannerCard>[]);
    return db.transaction((txn) async {
      final meta = await txn.query(
        'meta',
        where: 'key = ?',
        whereArgs: ['reminder_settings'],
      );
      final rows = await txn.query('cards');
      return (
        settings: meta.isEmpty
            ? null
            : ReminderSettings.fromJson(
                jsonDecode(meta.first['value'] as String)
                    as Map<String, dynamic>,
              ),
        cards: rows
            .map(
              (row) => PlannerCard.fromJson(
                jsonDecode(row['json'] as String) as Map<String, dynamic>,
              ),
            )
            .toList(),
      );
    });
  }

  Future<List<PlannerCard>> searchCards(String query) async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query('cards');
    final cards =
        rows
            .map(
              (row) => PlannerCard.fromJson(
                jsonDecode(row['json']! as String) as Map<String, dynamic>,
              ),
            )
            .where((card) => cardTextMatches(card.title, card.note, query))
            .toList()
          ..sort((a, b) {
            final day = b.day.compareTo(a.day);
            return day != 0 ? day : a.sortIndex.compareTo(b.sortIndex);
          });
    return cards.take(maxSearchResults).toList();
  }

  Future<List<String>> allTags() async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query('cards', columns: ['json']);
    final tags = <String, String>{};
    for (final row in rows) {
      final card = PlannerCard.fromJson(
        jsonDecode(row['json']! as String) as Map<String, dynamic>,
      );
      for (final tag in card.tags) {
        tags.putIfAbsent(tagKey(tag), () => tag);
      }
    }
    final sorted = tags.values.toList()
      ..sort((a, b) => tagKey(a).compareTo(tagKey(b)));
    return sorted;
  }

  /* -------------------------------------------------------------- senkron */

  Future<String?> get lastSync async => _meta('last_sync');
  Future<void> setLastSync(String value) => _setMeta('last_sync', value);

  Future<String?> _meta(String key) async {
    final db = await _open();
    if (db == null) return null;
    final rows = await db.query(
      'meta',
      where: 'key = ?',
      whereArgs: [key],
      limit: 1,
    );
    return rows.isEmpty ? null : rows.first['value'] as String;
  }

  Future<void> _setMeta(String key, String value) async {
    final db = await _open();
    await db?.insert('meta', {
      'key': key,
      'value': value,
    }, conflictAlgorithm: ConflictAlgorithm.replace);
  }

  /// Oturum kapanınca yerel kopya da silinir.
  Future<void> clear() async {
    final db = await _open();
    if (db == null) return;
    await db.delete('cards');
    await db.delete('queue');
    await db.delete('meta');
  }

  /// Pano değişirken başka panonun kartları ve delta imleci taşınmaz.
  Future<void> clearBoardData() async {
    final db = await _open();
    if (db == null) return;
    await db.delete('cards');
    await db.delete('meta', where: 'key = ?', whereArgs: ['last_sync']);
    await db.delete('meta', where: 'key = ?', whereArgs: ['reminder_settings']);
  }

  /* --------------------------------------------------------------- kuyruk */

  Future<void> enqueue(
    String method,
    String path,
    Map<String, dynamic>? body, {
    PlannerCard? baseCard,
  }) async {
    final db = await _open();
    if (db == null) throw StateError('Offline write queue is unavailable.');
    await db.insert('queue', {
      'method': method,
      'path': path,
      'body': body == null ? null : jsonEncode(body),
      'base_card': baseCard == null ? null : jsonEncode(baseCard.toJson()),
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<List<PendingWrite>> pending() async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query('queue', orderBy: 'id');
    return rows.map(PendingWrite.fromRow).toList();
  }

  Future<void> dequeue(int id) async {
    final db = await _open();
    await db?.delete('queue', where: 'id = ?', whereArgs: [id]);
  }

  Future<void> recordFailure(int id, Map<String, dynamic> failure) async {
    final db = await _open();
    await db?.update(
      'queue',
      {'failure': jsonEncode(failure)},
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  Future<void> resolveConflict(PendingWrite item) async {
    final db = await _open();
    if (db == null) return;
    await db.transaction((txn) async {
      final related = (await txn.query('queue', orderBy: 'id'))
          .map(PendingWrite.fromRow)
          .where((entry) => entry.cardId == item.cardId);
      for (final entry in related) {
        if (entry.body?['updatedAt'] != item.body?['updatedAt']) continue;
        await txn.update(
          'queue',
          {
            'body': jsonEncode({
              ...?entry.body,
              'updatedAt': item.serverCard!.updatedAt,
            }),
            if (entry.id == item.id) 'failure': null,
          },
          where: 'id = ?',
          whereArgs: [entry.id],
        );
      }
    });
  }

  /// Acknowledgement and dependent version updates are atomic. Unrelated edits
  /// keep their original version, so a genuine remote conflict remains visible.
  Future<void> completeWrite(PendingWrite item, PlannerCard? saved) async {
    final db = await _open();
    if (db == null) return;
    await db.transaction((txn) async {
      await txn.delete('queue', where: 'id = ?', whereArgs: [item.id]);
      if (saved == null) return;
      final rows = await txn.query('queue', orderBy: 'id');
      var hasPending = false;
      for (final row in rows) {
        final body = row['body'] == null
            ? null
            : jsonDecode(row['body'] as String) as Map<String, dynamic>;
        final path = row['path'] as String;
        if (path != '/cards/${saved.id}' &&
            !path.startsWith('/cards/${saved.id}/')) {
          continue;
        }
        hasPending = true;
        await txn.update(
          'queue',
          {'base_card': jsonEncode(saved.toJson())},
          where: 'id = ?',
          whereArgs: [row['id']],
        );
        if (body != null &&
            body['updatedAt'] == (item.body?['updatedAt'] ?? '')) {
          body['updatedAt'] = saved.updatedAt;
          await txn.update(
            'queue',
            {'body': jsonEncode(body)},
            where: 'id = ?',
            whereArgs: [row['id']],
          );
        }
      }
      // Preserve the accumulated local draft when another operation is queued.
      final cached = await txn.query(
        'cards',
        where: 'id = ?',
        whereArgs: [saved.id],
      );
      final card = hasPending && cached.isNotEmpty
          ? PlannerCard.fromJson(
              jsonDecode(cached.first['json'] as String)
                  as Map<String, dynamic>,
            ).copyWith(updatedAt: saved.updatedAt)
          : saved;
      if (card.archivedAt != null || card.trashedAt != null) {
        await txn.delete('cards', where: 'id = ?', whereArgs: [card.id]);
      } else if (!hasPending || cached.isNotEmpty) {
        await txn.insert('cards', {
          'id': card.id,
          'day': card.day,
          'sort_index': card.sortIndex,
          'updated_at': card.updatedAt,
          'json': jsonEncode(card.toJson()),
        }, conflictAlgorithm: ConflictAlgorithm.replace);
      }
    });
  }

  /// Cancel all dependent writes for this card and restore the first baseline.
  Future<PlannerCard?> discardCardWrites(PendingWrite selected) async {
    final db = await _open();
    if (db == null) return null;
    return db.transaction((txn) async {
      final all = (await txn.query('queue', orderBy: 'id'))
          .map(PendingWrite.fromRow)
          .where((item) => item.cardId == selected.cardId)
          .toList();
      if (!all.any((item) => item.id == selected.id)) return null;
      final restored =
          selected.serverCard ??
          all.map((item) => item.serverCard).nonNulls.lastOrNull ??
          all.first.original;
      for (final item in all) {
        await txn.delete('queue', where: 'id = ?', whereArgs: [item.id]);
      }
      await txn.delete('cards', where: 'id = ?', whereArgs: [selected.cardId]);
      if (restored != null &&
          restored.archivedAt == null &&
          restored.trashedAt == null) {
        await txn.insert('cards', {
          'id': restored.id,
          'day': restored.day,
          'sort_index': restored.sortIndex,
          'updated_at': restored.updatedAt,
          'json': jsonEncode(restored.toJson()),
        });
      }
      await txn.delete('meta', where: 'key = ?', whereArgs: ['last_sync']);
      return restored;
    });
  }

  Future<int> pendingCount() async {
    final db = await _open();
    if (db == null) return 0;
    final rows = await db.rawQuery('SELECT COUNT(*) AS n FROM queue');
    return (rows.first['n'] as int?) ?? 0;
  }

  /// Testler için: bellekte çalışan kopya.
  static Future<void> useInMemory() => useForTesting();

  @visibleForTesting
  static Future<void> useForTesting({
    String path = inMemoryDatabasePath,
  }) async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    await instance._db?.close();
    instance._initFailed = false;
    instance._db = await instance._openAt(path);
  }
}

/// Çevrimdışı oluşturulan kartlar için istemci tarafı kimlik.
/// Sunucu istemcinin verdiği id'yi kabul ediyor, böylece senkronda çakışma olmuyor.
String newUuid() {
  final random = Random.secure();
  final bytes = List<int>.generate(16, (_) => random.nextInt(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // sürüm 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // varyant
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}'
      '-${hex.substring(16, 20)}-${hex.substring(20)}';
}
