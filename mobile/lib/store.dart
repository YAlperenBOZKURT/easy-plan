import 'dart:async';
import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'api/api_client.dart';
import 'api/models.dart';
import 'accessibility.dart';
import 'cache.dart';
import 'dates.dart';
import 'notifications.dart';
import 'tags.dart';
import 'sync_queue.dart';
import 'localization.dart';

/// Uygulama durumu. Ek paket kullanmadan ChangeNotifier + ListenableBuilder.
class PlannerStore extends ChangeNotifier {
  PlannerStore({Notifications? notifications})
    : notifications = notifications ?? Notifications.instance;
  final Notifications notifications;
  int _notificationReadRevision = 0;
  bool _notificationsBlocked = false;

  static const _storage = FlutterSecureStorage();
  static const _legacyTokenKey = 'planner_token';
  static const _accessTokenKey = 'planner_access_token';
  static const _refreshTokenKey = 'planner_refresh_token';
  static const _boardKey = 'planner_active_board';
  static const _languageKey = 'easy_plan_language';
  static const _motionPreferenceKey = 'easy_plan_motion_preference';
  static const _textDensityKey = 'easy_plan_text_density';

  Locale appLocale = const Locale('tr');
  MotionPreference motionPreference = MotionPreference.system;
  TextDensity textDensity = TextDensity.standard;

  Future<void> setLanguage(String languageCode) async {
    if (languageCode != 'tr' && languageCode != 'en') return;
    final next = Locale(languageCode);
    if (appLocale == next) return;
    appLocale = next;
    notifyListeners();
    await _storage.write(key: _languageKey, value: languageCode);
    await refreshNotifications();
  }

  Future<void> setMotionPreference(MotionPreference value) async {
    if (motionPreference == value) return;
    motionPreference = value;
    notifyListeners();
    await _storage.write(key: _motionPreferenceKey, value: value.storageValue);
  }

  Future<void> setTextDensity(TextDensity value) async {
    if (textDensity == value) return;
    textDensity = value;
    notifyListeners();
    await _storage.write(key: _textDensityKey, value: value.storageValue);
  }

  /// Emülatörde makinenin localhost'u 10.0.2.2'dir; masaüstünde doğrudan localhost.
  static const defaultBaseUrl = String.fromEnvironment(
    'PLANNER_API_URL',
    defaultValue: 'http://localhost:3000',
  );

  late ApiClient api = ApiClient(baseUrl: defaultBaseUrl);

  PlannerUser? user;
  List<PlannerBoard> boards = const [];
  PlannerBoard? activeBoard;
  bool get boardReadOnly => activeBoard != null && !activeBoard!.canEdit;
  bool booting = true;
  bool loading = false;
  String? error;

  /// Sunucuya ulaşılamıyor; ekrandaki veri yerel kopyadan geliyor.
  bool offline = false;

  /// Gönderilmeyi bekleyen çevrimdışı değişiklik sayısı.
  int pendingWrites = 0;
  List<PendingWrite> pendingQueue = const [];

  Timer? _autoSync;
  Future<bool>? _queueFlushInFlight;
  Future<void>? _syncInFlight;
  int _localWriteRevision = 0;

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
    await refreshNotifications();
    await syncNow();
    await loadRange();
  }

  Future<void> refreshNotifications({bool restoreCachedSession = false}) async {
    if (!notifications.enabled || _notificationsBlocked) return;
    final request = ++_notificationReadRevision;
    final revision = _localWriteRevision;
    final snapshot = await Cache.instance.reminderSnapshot();
    if (request != _notificationReadRevision ||
        revision != _localWriteRevision) {
      return;
    }
    final settings = snapshot.settings;
    final authenticated =
        user?.id == settings?.userId ||
        (restoreCachedSession && api.refreshToken != null);
    if (settings == null ||
        !authenticated ||
        settings.boardId != api.activeBoardId) {
      await notifications.clear();
      return;
    }
    await notifications.reconcile(
      snapshot.cards,
      settings,
      language: appLocale.languageCode,
    );
  }

  Future<void> _resetNotifications() {
    _notificationsBlocked = true;
    _localWriteRevision += 1;
    _notificationReadRevision += 1;
    return notifications.clear();
  }

  @override
  void dispose() {
    stopAutoSync();
    super.dispose();
  }

  /// Görünen pencerenin ilk günü (varsayılan bugün).
  String anchor = todayKey();
  final Map<String, List<PlannerCard>> _byDay = {};
  String? _rangeFrom;
  String? _rangeTo;

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
  String get dataFrom => _rangeFrom ?? from;
  String get dataTo => _rangeTo ?? to;
  String get minDay => addYears(todayKey(), -1);
  String get maxDay => addYears(todayKey(), 1);

  List<PlannerCard> cardsOf(String day) => _byDay[day] ?? const [];
  List<PlannerCard> get loadedCards {
    final cards = _byDay.values.expand((items) => items).toList();
    cards.sort((a, b) {
      final day = a.day.compareTo(b.day);
      return day != 0 ? day : a.sortIndex.compareTo(b.sortIndex);
    });
    return cards;
  }

  List<String> get allTags {
    final seen = <String, String>{};
    for (final list in _byDay.values) {
      for (final card in list) {
        for (final tag in card.tags) {
          seen.putIfAbsent(tagKey(tag), () => tag);
        }
      }
    }
    final sorted = seen.values.toList()
      ..sort((a, b) => tagKey(a).compareTo(tagKey(b)));
    return sorted;
  }

  Future<List<String>> availableTags() async {
    final values = <String, String>{
      for (final tag in allTags) tagKey(tag): tag,
    };
    try {
      for (final tag in await api.tags()) {
        values.putIfAbsent(tagKey(tag), () => tag);
      }
    } catch (_) {
      for (final tag in await Cache.instance.allTags()) {
        values.putIfAbsent(tagKey(tag), () => tag);
      }
    }
    final sorted = values.values.toList()
      ..sort((a, b) => tagKey(a).compareTo(tagKey(b)));
    return sorted;
  }

  /* --------------------------------------------------------- açılış */

  Future<void> bootstrap() async {
    final savedLanguage = await _storage.read(key: _languageKey);
    motionPreference = motionPreferenceFromStorage(
      await _storage.read(key: _motionPreferenceKey),
    );
    textDensity = textDensityFromStorage(
      await _storage.read(key: _textDensityKey),
    );
    final systemLanguage = PlatformDispatcher.instance.locale.languageCode;
    appLocale = Locale(
      savedLanguage == 'tr' || savedLanguage == 'en'
          ? savedLanguage!
          : systemLanguage == 'tr'
          ? 'tr'
          : 'en',
    );
    final savedAccessToken = await _storage.read(key: _accessTokenKey);
    final savedRefreshToken = await _storage.read(key: _refreshTokenKey);
    final savedBoardId = await _storage.read(key: _boardKey);
    // Opaque sessions from versions before the JWT migration are invalidated.
    await _storage.delete(key: _legacyTokenKey);
    // Server selection was removed from the login UI; discard older overrides.
    await _storage.delete(key: 'planner_base_url');
    api = ApiClient(
      baseUrl: defaultBaseUrl,
      accessToken: savedAccessToken,
      refreshToken: savedRefreshToken,
      activeBoardId: savedBoardId,
      onTokensChanged: _storeTokens,
      onAuthenticationFailed: _handleAuthenticationFailed,
    );

    if (savedRefreshToken != null) {
      // Önce yerel kopya: internet olmasa da takvim anında görünür.
      await _loadFromCache(restoreCachedSession: true);
      pendingQueue = await Cache.instance.pending();
      pendingWrites = pendingQueue.length;

      try {
        user = await api.me();
        await loadBoards(preferredId: savedBoardId);
        offline = false;
        booting = false;
        notifyListeners();
        await syncNow();
        await loadRange();
        return;
      } on ApiException catch (e) {
        if (e.statusCode >= 500 || e.statusCode == 429) {
          offline = true;
          final cached = await Cache.instance.reminderSnapshot();
          user = PlannerUser(
            id: cached.settings?.userId ?? '',
            email: '',
            name: '',
            role: 'user',
          );
        } else {
          await _resetNotifications();
          await _clearTokens();
        }
      } catch (_) {
        // Sunucuya ulaşılamıyor: jetonu koru, çevrimdışı devam et.
        offline = true;
        final cached = await Cache.instance.reminderSnapshot();
        if (cached.settings != null || cached.cards.isNotEmpty) {
          user = PlannerUser(
            id: cached.settings?.userId ?? '',
            email: '',
            name: '',
            role: 'user',
          );
        }
      }
    }
    if (savedRefreshToken == null) await _resetNotifications();
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
      final cached = await Cache.instance.reminderSnapshot();
      if (cached.settings != null &&
          cached.settings!.userId != result.user.id) {
        if (await Cache.instance.pendingCount() > 0) {
          error =
              'Önceki hesabın bekleyen değişiklikleri var. Önce o hesapla giriş yap.';
          return false;
        }
        await _resetNotifications();
        await Cache.instance.clear();
        _byDay.clear();
      }
      api.accessToken = result.accessToken;
      api.refreshToken = result.refreshToken;
      user = result.user;
      if (cached.settings?.userId == result.user.id) {
        api.activeBoardId = cached.settings!.boardId;
      }
      await loadBoards();
      await _storeTokens(result.accessToken, result.refreshToken);
      await syncNow();
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
    stopAutoSync();
    user = null;
    await _resetNotifications();
    try {
      await api.logout();
    } catch (_) {
      // çevrimdışıysa da yerel oturumu kapat
    }
    await _clearTokens();
    await Cache.instance.clear();
    user = null;
    boards = const [];
    activeBoard = null;
    offline = false;
    pendingWrites = 0;
    pendingQueue = const [];
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
    await _storage.delete(key: _boardKey);
    api.accessToken = null;
    api.refreshToken = null;
  }

  Future<void> _handleAuthenticationFailed() async {
    user = null;
    stopAutoSync();
    await _resetNotifications();
    await _clearTokens();
    notifyListeners();
  }

  /* ----------------------------------------------------------- panolar */

  Future<void> loadBoards({String? preferredId}) async {
    final loaded = await api.boards();
    boards = loaded;
    final preferred = preferredId ?? api.activeBoardId;
    activeBoard = loaded.where((board) => board.id == preferred).firstOrNull;
    activeBoard ??= loaded.where((board) => board.personal).firstOrNull;
    activeBoard ??= loaded.firstOrNull;
    if (api.activeBoardId != null && api.activeBoardId != activeBoard?.id) {
      if (await Cache.instance.pendingCount() > 0) {
        throw ApiException(403, 'board_forbidden');
      }
      await _resetNotifications();
      await Cache.instance.clearBoardData();
      _byDay.clear();
    }
    api.activeBoardId = activeBoard?.id;
    if (activeBoard case final board?) {
      await _storage.write(key: _boardKey, value: board.id);
    }
    notifyListeners();
  }

  Future<bool> switchBoard(PlannerBoard board) async {
    if (activeBoard?.id == board.id) return true;
    await _flushQueue();
    if (pendingWrites > 0) {
      error =
          'Bekleyen çevrimdışı değişiklikler gönderilmeden pano değiştirilemez.';
      notifyListeners();
      return false;
    }
    await _resetNotifications();
    activeBoard = board;
    api.activeBoardId = board.id;
    await _storage.write(key: _boardKey, value: board.id);
    _byDay.clear();
    await Cache.instance.clearBoardData();
    notifyListeners();
    await _syncInFlight;
    await syncNow();
    await loadRange();
    return true;
  }

  Future<void> renameBoard(PlannerBoard board, String name) async {
    await api.updateBoard(board.id, name);
    await loadBoards(preferredId: board.id);
  }

  Future<void> deleteBoard(PlannerBoard board) async {
    await api.deleteBoard(board.id);
    await _resetNotifications();
    api.activeBoardId = null;
    activeBoard = null;
    _byDay.clear();
    await Cache.instance.clearBoardData();
    await loadBoards();
    await syncNow();
    await loadRange();
  }

  Future<void> leaveBoard(PlannerBoard board) async {
    final currentUser = user;
    if (currentUser == null) return;
    await api.removeBoardMember(board.id, currentUser.id);
    await _resetNotifications();
    api.activeBoardId = null;
    activeBoard = null;
    _byDay.clear();
    await Cache.instance.clearBoardData();
    await loadBoards();
    await syncNow();
    await loadRange();
  }

  /* --------------------------------------------------------- senkron */

  Future<void> _loadFromCache({bool restoreCachedSession = false}) async {
    final cached = await Cache.instance.cardsBetween(dataFrom, dataTo);
    _fill(cached);
    await refreshNotifications(restoreCachedSession: restoreCachedSession);
    notifyListeners();
  }

  void _fill(List<PlannerCard> cards) {
    _byDay.clear();
    for (final card in cards) {
      (_byDay[card.day] ??= []).add(card);
    }
    for (final list in _byDay.values) {
      list.sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    }
  }

  /// Delta senkron: yalnızca değişenleri çeker, silinenleri tombstone'dan uygular.
  /// Öncesinde bekleyen çevrimdışı yazmalar sunucuya gönderilir.
  Future<void> syncNow() {
    return _syncInFlight ??= _syncNow().whenComplete(() {
      _syncInFlight = null;
    });
  }

  Future<void> _syncNow() async {
    final revision = _localWriteRevision;
    if (!await _flushQueue()) {
      notifyListeners();
      return;
    }
    if (revision != _localWriteRevision) return;
    try {
      final since = await Cache.instance.lastSync;
      final delta = await api.changes(since: since);
      if (revision != _localWriteRevision ||
          await Cache.instance.pendingCount() > 0) {
        return;
      }
      final applied = await Cache.instance.applyServerChanges(
        delta.cards,
        deletions: delta.deletions
            .where((d) => d['entity'] == 'card')
            .map((d) => d['id'] as String),
        serverTime: delta.serverTime,
        reminderSettings: delta.reminderSettings,
        replaceAll: since == null && delta.reminderSettings != null,
      );
      if (!applied || revision != _localWriteRevision) return;
      if (delta.reminderSettings != null &&
          delta.reminderSettings!.userId == user?.id &&
          delta.reminderSettings!.boardId == api.activeBoardId) {
        _notificationsBlocked = false;
      }
      await refreshNotifications();
      offline = false;
      error = null;
    } on ApiException catch (e) {
      if (e.statusCode == 403 || e.statusCode == 401) {
        await _resetNotifications();
      }
      offline = true;
    } catch (_) {
      offline = true;
    }
    notifyListeners();
  }

  /// Çevrimdışıyken biriken yazmaları sırayla gönderir.
  Future<bool> _flushQueue() {
    return _queueFlushInFlight ??= _replayQueue().whenComplete(() {
      _queueFlushInFlight = null;
    });
  }

  Future<bool> _replayQueue() async {
    try {
      while (true) {
        final queued = await Cache.instance.pending();
        if (queued.isEmpty) return true;
        final item = queued.first;
        if (item.conflict) {
          offline = false;
          return false;
        }
        PlannerCard? saved;
        try {
          final result = await api.raw(item.method, item.path, body: item.body);
          if (result is Map && result['card'] is Map) {
            saved = PlannerCard.fromJson(
              Map<String, dynamic>.from(result['card'] as Map),
            );
          }
        } on ApiException catch (e) {
          // Yanıt kaybolmuş olabilir: oluşturma/silme zaten uygulanmışsa
          // aynı kimlikle tekrar gönderilen işlem tamamlanmış sayılır.
          final alreadyCreated =
              item.method == 'POST' &&
              item.path == '/cards' &&
              item.body?['id'] is String &&
              e.statusCode == 409 &&
              e.code == 'already_exists';
          final alreadyDeleted =
              item.method == 'DELETE' &&
              RegExp(r'^/cards/[^/]+$').hasMatch(item.path) &&
              e.statusCode == 404 &&
              e.code == 'not_found';
          if (!alreadyCreated && !alreadyDeleted) {
            if (e.statusCode == 401 || e.statusCode == 403) {
              await _resetNotifications();
            }
            await Cache.instance.recordFailure(item.id, {
              'error': e.code,
              ...?e.payload,
            });
            offline = e.code != 'stale_write';
            error = AppStrings(appLocale).text(
              e.code == 'stale_write' ? 'conflict.title' : 'conflict.failed',
            );
            return false;
          }
          if (alreadyCreated) {
            // Recover the acknowledged version before replaying dependent edits.
            try {
              final result = await api.raw('GET', '/cards/${item.cardId}');
              saved = PlannerCard.fromJson(
                Map<String, dynamic>.from(result['card'] as Map),
              );
            } catch (_) {
              offline = true;
              return false;
            }
          }
        } catch (_) {
          await Cache.instance.recordFailure(item.id, {
            'error': 'network_error',
          });
          offline = true;
          return false;
        }
        await Cache.instance.completeWrite(item, saved);
      }
    } finally {
      pendingQueue = await Cache.instance.pending();
      pendingWrites = pendingQueue.length;
      await refreshNotifications();
    }
  }

  Future<void> keepLocalWrite(int id) async {
    if (boardReadOnly) return;
    await _resolveQueuedWrite(id, discard: false);
    await syncNow();
    await loadRange();
  }

  Future<void> discardCardWrites(int id) async {
    await _resolveQueuedWrite(id, discard: true);
    await syncNow();
    await loadRange();
  }

  Future<void> _resolveQueuedWrite(int id, {required bool discard}) async {
    while (_queueFlushInFlight != null) {
      await _queueFlushInFlight;
    }
    // Reserve the replay lock before the next async boundary. Automatic sync
    // must not deliver a write while a user's resolution is changing the queue.
    final operation = _applyQueueDecision(id, discard: discard);
    _queueFlushInFlight = operation.whenComplete(() {
      _queueFlushInFlight = null;
    });
    await _queueFlushInFlight;
  }

  Future<bool> _applyQueueDecision(int id, {required bool discard}) async {
    final item = (await Cache.instance.pending())
        .where((item) => item.id == id)
        .firstOrNull;
    if (item == null) return false;
    if (discard) {
      _localWriteRevision += 1;
      await Cache.instance.discardCardWrites(item);
      error = null;
      await _loadFromCache();
    } else {
      if (!item.conflict) return false;
      await Cache.instance.resolveConflict(item);
    }
    return _replayQueue();
  }

  /* --------------------------------------------------------- kartlar */

  Future<void> loadRange() async {
    loading = true;
    notifyListeners();
    final revision = _localWriteRevision;
    try {
      pendingWrites = await Cache.instance.pendingCount();
      if (pendingWrites > 0) {
        final cached = await Cache.instance.cardsBetween(dataFrom, dataTo);
        if (revision == _localWriteRevision) _fill(cached);
        return;
      }
      final cards = await api.cards(dataFrom, dataTo);
      if (revision != _localWriteRevision ||
          await Cache.instance.pendingCount() > 0) {
        return;
      }
      final applied = await Cache.instance.applyServerChanges(cards);
      if (!applied || revision != _localWriteRevision) return;
      _fill(cards);
      await refreshNotifications();
      offline = false;
      error = null;
    } on ApiException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 403) {
        await _resetNotifications();
      }
      error = 'Kartlar alınamadı (${e.code}).';
    } catch (_) {
      // Ağ yok: yerel kopyayla devam.
      offline = true;
      error = null;
      _fill(await Cache.instance.cardsBetween(dataFrom, dataTo));
    } finally {
      await refreshNotifications();
      loading = false;
      notifyListeners();
    }
  }

  Future<({List<PlannerCard> cards, bool offline})> searchCards(
    String query,
  ) async {
    if (await Cache.instance.pendingCount() > 0) {
      return (cards: await Cache.instance.searchCards(query), offline: true);
    }
    final revision = _localWriteRevision;
    try {
      final cards = await api.searchCards(query);
      if (revision != _localWriteRevision ||
          await Cache.instance.pendingCount() > 0) {
        return (cards: await Cache.instance.searchCards(query), offline: true);
      }
      final applied = await Cache.instance.applyServerChanges(cards);
      if (!applied || revision != _localWriteRevision) {
        return (cards: await Cache.instance.searchCards(query), offline: true);
      }
      await refreshNotifications();
      return (cards: cards, offline: false);
    } on ApiException catch (e) {
      if (e.statusCode == 401 || e.statusCode == 403) {
        await _resetNotifications();
      }
      return (cards: await Cache.instance.searchCards(query), offline: true);
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
    _rangeFrom = null;
    _rangeTo = null;
    notifyListeners();
    loadRange();
  }

  void goToday() {
    anchor = todayKey();
    _rangeFrom = null;
    _rangeTo = null;
    notifyListeners();
    loadRange();
  }

  Future<void> setPlannerRange({
    required String anchorDay,
    String? from,
    String? to,
  }) async {
    anchor = anchorDay;
    _rangeFrom = from;
    _rangeTo = to;
    notifyListeners();
    await loadRange();
  }

  Future<void> toggleDone(PlannerCard card) async {
    if (boardReadOnly) return;
    final updated = card.copyWith(done: !card.done, templateId: null);
    await _write(
      optimistic: () => _replaceLocal(updated),
      method: 'PATCH',
      path: '/cards/${card.id}',
      baseCard: card,
      body: {'done': updated.done, 'updatedAt': card.updatedAt},
    );
  }

  Future<void> toggleChecklistItem(PlannerCard card, String itemId) async {
    if (boardReadOnly) return;
    final checklist = card.checklist
        .map(
          (item) => item.id == itemId ? item.copyWith(done: !item.done) : item,
        )
        .toList();
    final done = isChecklistComplete(checklist);
    final updated = card.copyWith(
      checklist: checklist,
      done: done,
      templateId: null,
    );
    final body = <String, dynamic>{
      'checklist': checklist.map((item) => item.toJson()).toList(),
      'done': done,
      'updatedAt': card.updatedAt,
    };
    await _write(
      optimistic: () => _replaceLocal(updated),
      method: 'PATCH',
      path: '/cards/${card.id}',
      body: body,
      baseCard: card,
    );
  }

  Future<void> deleteCard(PlannerCard card) async {
    if (boardReadOnly) return;
    await _write(
      optimistic: () => _removeLocal(card.id),
      method: 'DELETE',
      path: '/cards/${card.id}',
      baseCard: card,
    );
  }

  Future<void> archiveCard(PlannerCard card) async {
    if (boardReadOnly) return;
    await _write(
      optimistic: () => _removeLocal(card.id),
      method: 'POST',
      path: '/cards/${card.id}/archive',
      baseCard: card,
    );
  }

  Future<void> duplicateCard(PlannerCard card) async {
    if (boardReadOnly) return;
    try {
      final duplicate = await api.duplicateCard(card.id);
      await _replaceLocal(duplicate);
      offline = false;
      error = null;
      notifyListeners();
    } on ApiException catch (e) {
      error = 'Kart çoğaltılamadı (${e.code}).';
      notifyListeners();
    } catch (_) {
      error = 'Kart çoğaltılamadı: sunucuya ulaşılamadı.';
      notifyListeners();
    }
  }

  Future<bool> saveCardAsTemplate(PlannerCard card, String name) async {
    if (boardReadOnly) return false;
    try {
      await api.saveCardAsTemplate(card.id, name);
      await loadRange();
      error = null;
      return true;
    } on ApiException catch (e) {
      error = 'Şablon kaydedilemedi (${e.code}).';
    } catch (_) {
      error = 'Şablon kaydedilemedi: sunucuya ulaşılamadı.';
    }
    notifyListeners();
    return false;
  }

  Future<void> restoreCard(PlannerCard card) async {
    if (boardReadOnly) return;
    final restored = await api.restoreCard(card.id);
    await Cache.instance.saveCards([restored]);
    await loadRange();
  }

  Future<void> permanentlyDeleteCard(PlannerCard card) async {
    if (boardReadOnly) return;
    await api.permanentlyDeleteCard(card.id);
    await Cache.instance.removeCards([card.id]);
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
    String? templateId,
    bool resetOrder = false,
  }) async {
    if (boardReadOnly) return null;
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
      if (existing == null && templateId != null) 'templateId': templateId,
      if (checklist.isNotEmpty) 'done': isChecklistComplete(checklist),
      if (resetOrder) 'manualSort': false,
      if (existing != null) 'updatedAt': existing.updatedAt,
    };
    // Çevrimdışı oluşturulan kart için kimliği istemci üretir; sunucu kabul ediyor.
    final id = existing?.id ?? newUuid();
    if (existing == null) body['id'] = id;

    final local =
        (existing ??
                PlannerCard(
                  id: id,
                  boardId: api.activeBoardId,
                  creatorId: user?.id,
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
                  templateId: templateId,
                  reminders: const [],
                  images: const [],
                  updatedAt: '',
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
              templateId: existing == null ? templateId : null,
            );

    final optimisticCard = PlannerCard.fromJson({...local.toJson(), ...body});
    await _write(
      optimistic: () => _replaceLocal(optimisticCard),
      method: existing == null ? 'POST' : 'PATCH',
      path: existing == null ? '/cards' : '/cards/$id',
      body: body,
      baseCard: existing,
    );
    return optimisticCard;
  }

  /// Karta görsel yükler; kart yeni oluşturulduysa kaydedildikten sonra çağrılır.
  Future<bool> uploadImages(
    String cardId,
    List<({String name, Uint8List bytes})> files,
  ) async {
    if (boardReadOnly) return false;
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
    if (boardReadOnly) return;
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
    if (boardReadOnly) return;
    await _write(
      optimistic: () =>
          _replaceLocal(card.copyWith(day: day, templateId: null)),
      method: 'PATCH',
      path: '/cards/${card.id}/move',
      body: {
        'day': day,
        'beforeId': beforeId,
        'afterId': afterId,
        'updatedAt': card.updatedAt,
      },
      baseCard: card,
    );
  }

  /* ----------------------------------------------- yazma (çevrimdışı destekli) */

  Future<void> _replaceLocal(PlannerCard card) async {
    for (final list in _byDay.values) {
      list.removeWhere((c) => c.id == card.id);
    }
    (_byDay[card.day] ??= []).add(card);
    _byDay[card.day]?.sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    await Cache.instance.saveCards([card]);
    await refreshNotifications();
  }

  Future<void> _removeLocal(String id) async {
    for (final list in _byDay.values) {
      list.removeWhere((c) => c.id == id);
    }
    await Cache.instance.removeCards([id]);
    await refreshNotifications();
  }

  /// İsteği kalıcı kuyruğa yaz, yerelde uygula ve sırayla göndermeyi dene.
  Future<void> _write({
    required Future<void> Function() optimistic,
    required String method,
    required String path,
    Map<String, dynamic>? body,
    PlannerCard? baseCard,
  }) async {
    _localWriteRevision += 1;
    await Cache.instance.enqueue(method, path, body, baseCard: baseCard);
    await optimistic();
    pendingWrites = await Cache.instance.pendingCount();
    error = null;
    notifyListeners();
    if (await _flushQueue()) {
      offline = false;
      await loadRange();
    }
    notifyListeners();
  }
}
