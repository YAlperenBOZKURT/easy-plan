import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api/api_client.dart';
import 'api/models.dart';
import 'cache.dart';
import 'dates.dart';
import 'notifications.dart';

/// Uygulama durumu. Ek paket kullanmadan ChangeNotifier + ListenableBuilder.
class PlannerStore extends ChangeNotifier {
  PlannerStore();

  static const _storage = FlutterSecureStorage();
  static const _legacyTokenKey = 'planner_token';
  static const _accessTokenKey = 'planner_access_token';
  static const _refreshTokenKey = 'planner_refresh_token';

  /// Emülatörde makinenin localhost'u 10.0.2.2'dir; masaüstünde doğrudan localhost.
  static const defaultBaseUrl = String.fromEnvironment(
    'PLANNER_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  late ApiClient api = ApiClient(baseUrl: defaultBaseUrl);

  PlannerUser? user;
  bool booting = true;
  bool loading = false;
  String? error;

  /// Sunucuya ulaşılamıyor; ekrandaki veri yerel kopyadan geliyor.
  bool offline = false;

  /// Gönderilmeyi bekleyen çevrimdışı değişiklik sayısı.
  int pendingWrites = 0;

  Timer? _autoSync;

  /// Başka cihazdaki değişiklikler kendiliğinden gelsin diye düzenli senkron.
  void startAutoSync({Duration every = const Duration(seconds: 20)}) {
    _autoSync?.cancel();
    _autoSync = Timer.periodic(every, (_) => refreshFromServer());
  }

  void stopAutoSync() {
    _autoSync?.cancel();
    _autoSync = null;
  }

  /// Delta senkron + görünen aralığı tazele (elle "Senkronize et" ile aynı iş).
  Future<void> refreshFromServer() async {
    if (user == null) return;
    await syncNow();
    await loadRange();
  }

  @override
  void dispose() {
    stopAutoSync();
    super.dispose();
  }

  /// Görünen pencerenin ilk günü (varsayılan bugün).
  String anchor = todayKey();
  final Map<String, List<PlannerCard>> _byDay = {};

  /// Ekrana kaç gün sığıyorsa o kadarı gösterilir (kolonlar okunmaz hâle gelmesin).
  int visibleDays = 7;

  void setVisibleDays(int count) {
    final next = count.clamp(1, 7);
    if (next == visibleDays) return;
    visibleDays = next;
    notifyListeners();
    loadRange();
  }

  List<String> get days =>
      List.generate(visibleDays, (i) => addDays(anchor, i));
  String get from => days.first;
  String get to => days.last;
  String get minDay => addYears(todayKey(), -1);
  String get maxDay => addYears(todayKey(), 1);

  List<PlannerCard> cardsOf(String day) => _byDay[day] ?? const [];

  /* --------------------------------------------------------- açılış */

  Future<void> bootstrap() async {
    final savedAccessToken = await _storage.read(key: _accessTokenKey);
    final savedRefreshToken = await _storage.read(key: _refreshTokenKey);
    // Opaque sessions from versions before the JWT migration are invalidated.
    await _storage.delete(key: _legacyTokenKey);
    // Server selection was removed from the login UI; discard older overrides.
    await _storage.delete(key: 'planner_base_url');
    api = ApiClient(
      baseUrl: defaultBaseUrl,
      accessToken: savedAccessToken,
      refreshToken: savedRefreshToken,
      onTokensChanged: _storeTokens,
      onAuthenticationFailed: _handleAuthenticationFailed,
    );

    if (savedRefreshToken != null) {
      // Önce yerel kopya: internet olmasa da takvim anında görünür.
      await _loadFromCache();
      pendingWrites = await Cache.instance.pendingCount();

      try {
        user = await api.me();
        offline = false;
        booting = false;
        notifyListeners();
        await syncNow();
        await loadRange();
        return;
      } on ApiException {
        await _clearTokens();
      } catch (_) {
        // Sunucuya ulaşılamıyor: jetonu koru, çevrimdışı devam et.
        offline = true;
        if (_byDay.values.any((list) => list.isNotEmpty)) {
          user = PlannerUser(id: '', email: '', name: '', role: 'user');
        }
      }
    }
    booting = false;
    notifyListeners();
  }

  /* --------------------------------------------------------- kimlik */

  Future<bool> login(String email, String password) async {
    loading = true;
    error = null;
    notifyListeners();
    try {
      api = ApiClient(
        baseUrl: defaultBaseUrl,
        onTokensChanged: _storeTokens,
        onAuthenticationFailed: _handleAuthenticationFailed,
      );
      final result = await api.login(email.trim(), password);
      api.accessToken = result.accessToken;
      api.refreshToken = result.refreshToken;
      user = result.user;
      await _storeTokens(result.accessToken, result.refreshToken);
      await loadRange();
      return true;
    } on ApiException catch (e) {
      error = switch (e.code) {
        'invalid_credentials' => 'E-posta veya şifre hatalı.',
        'http_429' => 'Çok fazla deneme yapıldı, biraz bekle.',
        _ => 'Giriş yapılamadı (${e.code}).',
      };
      return false;
    } catch (_) {
      error = 'Sunucuya ulaşılamadı. Adresi ve ağı kontrol et.';
      return false;
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    try {
      await api.logout();
    } catch (_) {
      // çevrimdışıysa da yerel oturumu kapat
    }
    await _clearTokens();
    await Cache.instance.clear();
    user = null;
    offline = false;
    pendingWrites = 0;
    _byDay.clear();
    notifyListeners();
  }

  Future<void> _storeTokens(String accessToken, String refreshToken) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<void> _clearTokens() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _legacyTokenKey);
    api.accessToken = null;
    api.refreshToken = null;
  }

  Future<void> _handleAuthenticationFailed() async {
    await _clearTokens();
    user = null;
    stopAutoSync();
    notifyListeners();
  }

  /* --------------------------------------------------------- senkron */

  Future<void> _loadFromCache() async {
    final cached = await Cache.instance.cardsBetween(from, to);
    _fill(cached);
    notifyListeners();
  }

  void _fill(List<PlannerCard> cards) {
    _byDay
      ..clear()
      ..addEntries(days.map((d) => MapEntry(d, <PlannerCard>[])));
    for (final card in cards) {
      (_byDay[card.day] ??= []).add(card);
    }
    for (final list in _byDay.values) {
      list.sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    }
  }

  /// Delta senkron: yalnızca değişenleri çeker, silinenleri tombstone'dan uygular.
  /// Öncesinde bekleyen çevrimdışı yazmalar sunucuya gönderilir.
  Future<void> syncNow() async {
    await _flushQueue();
    try {
      final since = await Cache.instance.lastSync;
      final delta = await api.changes(since: since);
      await Cache.instance.saveCards(delta.cards);
      await Cache.instance.removeCards(
        delta.deletions
            .where((d) => d['entity'] == 'card')
            .map((d) => d['id'] as String),
      );
      await Cache.instance.setLastSync(delta.serverTime);
      offline = false;
    } catch (_) {
      offline = true;
    }
    notifyListeners();
  }

  /// Çevrimdışıyken biriken yazmaları sırayla gönderir.
  Future<void> _flushQueue() async {
    final queued = await Cache.instance.pending();
    for (final item in queued) {
      try {
        await api.raw(item.method, item.path, body: item.body);
        await Cache.instance.dequeue(item.id);
      } on ApiException {
        // Sunucu reddetti (ör. kart silinmiş): tekrar denemenin anlamı yok.
        await Cache.instance.dequeue(item.id);
      } catch (_) {
        return; // hâlâ çevrimdışı: kalanları sonraya bırak
      }
    }
    pendingWrites = await Cache.instance.pendingCount();
  }

  /* --------------------------------------------------------- kartlar */

  Future<void> loadRange() async {
    loading = true;
    notifyListeners();
    try {
      final cards = await api.cards(from, to);
      _fill(cards);
      await Cache.instance.saveCards(cards);
      // Görünen haftanın hatırlatmaları telefonda yerel bildirim olarak kurulur.
      unawaited(Notifications.instance.reschedule(cards));
      offline = false;
      error = null;
    } on ApiException catch (e) {
      error = 'Kartlar alınamadı (${e.code}).';
    } catch (_) {
      // Ağ yok: yerel kopyayla devam.
      offline = true;
      error = null;
      _fill(await Cache.instance.cardsBetween(from, to));
    } finally {
      loading = false;
      notifyListeners();
    }
  }

  Future<({List<PlannerCard> cards, bool offline})> searchCards(
    String query,
  ) async {
    try {
      final cards = await api.searchCards(query);
      // Arama sonucunu bekletmeden göster; önbellek yazımı arka planda tamamlanır.
      unawaited(Cache.instance.saveCards(cards).catchError((_) {}));
      return (cards: cards, offline: false);
    } catch (_) {
      return (cards: await Cache.instance.searchCards(query), offline: true);
    }
  }

  void shift(int delta) {
    final next = addDays(anchor, delta);
    if (next.compareTo(minDay) < 0 ||
        addDays(next, visibleDays - 1).compareTo(maxDay) > 0) {
      return;
    }
    anchor = next;
    notifyListeners();
    loadRange();
  }

  void goToday() {
    anchor = todayKey();
    notifyListeners();
    loadRange();
  }

  Future<void> toggleDone(PlannerCard card) async {
    final updated = card.copyWith(done: !card.done);
    await _write(
      optimistic: () => _replaceLocal(updated),
      send: () => api.updateCard(card.id, {'done': updated.done}),
      method: 'PATCH',
      path: '/cards/${card.id}',
      body: {'done': updated.done},
    );
  }

  Future<void> toggleChecklistItem(PlannerCard card, String itemId) async {
    final checklist = card.checklist
        .map(
          (item) => item.id == itemId
              ? item.copyWith(done: !item.done)
              : item,
        )
        .toList();
    final done = isChecklistComplete(checklist);
    final updated = card.copyWith(
      checklist: checklist,
      done: done,
      updatedAt: DateTime.now().toUtc().toIso8601String(),
    );
    final body = <String, dynamic>{
      'checklist': checklist.map((item) => item.toJson()).toList(),
      'done': done,
    };
    await _write(
      optimistic: () => _replaceLocal(updated),
      send: () => api.updateCard(card.id, body),
      method: 'PATCH',
      path: '/cards/${card.id}',
      body: body,
    );
  }

  Future<void> deleteCard(PlannerCard card) async {
    await _write(
      optimistic: () => _removeLocal(card.id),
      send: () async {
        await api.deleteCard(card.id);
        return null;
      },
      method: 'DELETE',
      path: '/cards/${card.id}',
    );
  }

  Future<PlannerCard?> saveCard({
    PlannerCard? existing,
    required String day,
    required String title,
    required String note,
    String? startTime,
    String? endTime,
    required String color,
    required String priority,
    required String? deadlineAt,
    required List<String> tags,
    required List<int> reminders,
    required List<ChecklistItem> checklist,
    bool resetOrder = false,
  }) async {
    final body = <String, dynamic>{
      'day': day,
      'title': title,
      'note': note,
      'startTime': startTime,
      'endTime': endTime,
      'color': color,
      'priority': priority,
      'deadlineAt': deadlineAt,
      'tags': tags,
      'reminders': reminders,
      'checklist': checklist.map((item) => item.toJson()).toList(),
      if (checklist.isNotEmpty) 'done': isChecklistComplete(checklist),
      if (resetOrder) 'manualSort': false,
    };
    // Çevrimdışı oluşturulan kart için kimliği istemci üretir; sunucu kabul ediyor.
    final id = existing?.id ?? newUuid();
    if (existing == null) body['id'] = id;

    final local =
        (existing ??
                PlannerCard(
                  id: id,
                  day: day,
                  title: '',
                  note: '',
                  startTime: null,
                  endTime: null,
                  color: color,
                  priority: priority,
                  deadlineAt: deadlineAt,
                  tags: tags,
                  done: false,
                  sortIndex: 9999,
                  manualSort: false,
                  habitId: null,
                  reminders: const [],
                  images: const [],
                  updatedAt: DateTime.now().toIso8601String(),
                ))
            .copyWith(
              day: day,
              title: title,
              note: note,
              startTime: startTime,
              endTime: endTime,
              color: color,
              priority: priority,
              deadlineAt: deadlineAt,
              tags: tags,
              reminders: reminders,
              checklist: checklist,
              done: checklist.isNotEmpty
                  ? isChecklistComplete(checklist)
                  : null,
              updatedAt: DateTime.now().toIso8601String(),
            );

    await _write(
      optimistic: () => _replaceLocal(local),
      send: () => existing == null
          ? api.createCard(body)
          : api.updateCard(existing.id, body),
      method: existing == null ? 'POST' : 'PATCH',
      path: existing == null ? '/cards' : '/cards/$id',
      body: body,
    );
    return local;
  }

  /// Karta görsel yükler; kart yeni oluşturulduysa kaydedildikten sonra çağrılır.
  Future<bool> uploadImages(
    String cardId,
    List<({String name, Uint8List bytes})> files,
  ) async {
    if (files.isEmpty) return true;
    try {
      await api.uploadImages(cardId, files);
      await loadRange();
      return true;
    } on ApiException catch (e) {
      error = e.code == 'unsupported_type'
          ? 'Bu dosya türü yüklenemiyor.'
          : 'Görsel yüklenemedi (${e.code}).';
      notifyListeners();
      return false;
    } catch (_) {
      error = 'Görsel yüklenemedi: sunucuya ulaşılamadı.';
      notifyListeners();
      return false;
    }
  }

  Future<void> deleteImage(String id) async {
    try {
      await api.deleteImage(id);
      await loadRange();
    } catch (_) {
      error = 'Görsel silinemedi.';
      notifyListeners();
    }
  }

  Future<void> moveCard(
    PlannerCard card, {
    required String day,
    String? beforeId,
    String? afterId,
  }) async {
    await _write(
      optimistic: () => _replaceLocal(card.copyWith(day: day)),
      send: () =>
          api.moveCard(card.id, day: day, beforeId: beforeId, afterId: afterId),
      method: 'PATCH',
      path: '/cards/${card.id}/move',
      body: {'day': day, 'beforeId': beforeId, 'afterId': afterId},
    );
  }

  /* ----------------------------------------------- yazma (çevrimdışı destekli) */

  void _replaceLocal(PlannerCard card) {
    for (final list in _byDay.values) {
      list.removeWhere((c) => c.id == card.id);
    }
    (_byDay[card.day] ??= []).add(card);
    _byDay[card.day]?.sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    unawaited(Cache.instance.saveCards([card]));
  }

  void _removeLocal(String id) {
    for (final list in _byDay.values) {
      list.removeWhere((c) => c.id == id);
    }
    unawaited(Cache.instance.removeCards([id]));
  }

  /// Önce ekranda uygula, sonra gönder. Ağ yoksa istek kuyruğa yazılır.
  Future<void> _write({
    required void Function() optimistic,
    required Future<Object?> Function() send,
    required String method,
    required String path,
    Map<String, dynamic>? body,
  }) async {
    optimistic();
    notifyListeners();
    try {
      await send();
      offline = false;
      await loadRange();
    } on ApiException catch (e) {
      error = 'İşlem yapılamadı (${e.code}).';
      notifyListeners();
    } catch (_) {
      // Ağ yok: değişiklik yerelde duruyor, istek kuyruğa alınıyor.
      await Cache.instance.enqueue(method, path, body);
      pendingWrites = await Cache.instance.pendingCount();
      offline = true;
      notifyListeners();
    }
  }
}
