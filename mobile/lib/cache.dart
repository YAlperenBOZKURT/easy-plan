import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart' as p;
import 'package:sqflite_common_ffi/sqflite_ffi.dart';

import 'api/models.dart';
import 'app_logger.dart';
import 'search.dart';
import 'tags.dart';

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
      _db = await openDatabase(
        p.join(dir, 'planner_cache.db'),
        version: 1,
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
              created_at TEXT NOT NULL
            )
          ''');
          await db.execute(
            'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
          );
        },
      );
      return _db;
    } catch (error, stack) {
      AppLogger.error('cache_open_failed', error, stack);
      _initFailed = true;
      return null;
    }
  }

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

  Future<List<PlannerCard>> searchCards(String query) async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query('cards');
    final cards = rows
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

  /* --------------------------------------------------------------- kuyruk */

  Future<void> enqueue(
    String method,
    String path,
    Map<String, dynamic>? body,
  ) async {
    final db = await _open();
    await db?.insert('queue', {
      'method': method,
      'path': path,
      'body': body == null ? null : jsonEncode(body),
      'created_at': DateTime.now().toIso8601String(),
    });
  }

  Future<
    List<({int id, String method, String path, Map<String, dynamic>? body})>
  >
  pending() async {
    final db = await _open();
    if (db == null) return const [];
    final rows = await db.query('queue', orderBy: 'id');
    return rows
        .map(
          (row) => (
            id: row['id']! as int,
            method: row['method']! as String,
            path: row['path']! as String,
            body: row['body'] == null
                ? null
                : jsonDecode(row['body']! as String) as Map<String, dynamic>,
          ),
        )
        .toList();
  }

  Future<void> dequeue(int id) async {
    final db = await _open();
    await db?.delete('queue', where: 'id = ?', whereArgs: [id]);
  }

  Future<int> pendingCount() async {
    final db = await _open();
    if (db == null) return 0;
    final rows = await db.rawQuery('SELECT COUNT(*) AS n FROM queue');
    return (rows.first['n'] as int?) ?? 0;
  }

  /// Testler için: bellekte çalışan kopya.
  static Future<void> useInMemory() async {
    sqfliteFfiInit();
    databaseFactory = databaseFactoryFfi;
    instance._db = await databaseFactory.openDatabase(
      inMemoryDatabasePath,
      options: OpenDatabaseOptions(
        version: 1,
        onCreate: (db, _) async {
          await db.execute(
            'CREATE TABLE cards (id TEXT PRIMARY KEY, day TEXT NOT NULL, sort_index REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT \'\', json TEXT NOT NULL)',
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
