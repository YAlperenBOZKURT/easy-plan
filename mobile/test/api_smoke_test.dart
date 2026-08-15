@Tags(['smoke'])
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/dates.dart';

/// Gerçek sunucuya karşı uçtan uca kontrol.
///
/// Kimlik bilgisi kaynağa yazılmaz; ortamdan okunur:
///   PLANNER_URL, PLANNER_EMAIL, PLANNER_PASSWORD
/// Değişkenler yoksa test atlanır.
void main() {
  final url = Platform.environment['PLANNER_URL'] ?? 'http://localhost:3000';
  final email = Platform.environment['PLANNER_EMAIL'];
  final password = Platform.environment['PLANNER_PASSWORD'];

  test('giriş, kart listesi ve delta senkron çalışıyor', () async {
    if (email == null || password == null) {
      markTestSkipped('PLANNER_EMAIL / PLANNER_PASSWORD verilmedi');
      return;
    }

    final api = ApiClient(baseUrl: url);
    final session = await api.login(email, password);
    expect(session.accessToken, isNotEmpty);
    expect(session.refreshToken, isNotEmpty);
    api.accessToken = session.accessToken;
    api.refreshToken = session.refreshToken;

    final me = await api.me();
    expect(me.email.toLowerCase(), email.toLowerCase());

    final from = todayKey();
    final to = addDays(from, 6);
    final cards = await api.cards(from, to);
    // ignore: avoid_print
    print('$from → $to arası ${cards.length} kart');
    for (final card in cards.take(3)) {
      // ignore: avoid_print
      print(
        '  ${card.day} ${card.timeLabel} ${card.title} '
        '(renk: ${card.color}, hatırlatma: ${card.reminders.length})',
      );
    }

    final delta = await api.changes();
    expect(delta.serverTime, isNotEmpty);
    // ignore: avoid_print
    print(
      'senkron: ${delta.cards.length} kart, ${delta.deletions.length} silme',
    );
  });

  test('karta görsel yüklenir ve silinir', () async {
    if (email == null || password == null) {
      markTestSkipped('PLANNER_EMAIL / PLANNER_PASSWORD verilmedi');
      return;
    }

    final api = ApiClient(baseUrl: url);
    final session = await api.login(email, password);
    api.accessToken = session.accessToken;
    api.refreshToken = session.refreshToken;

    final card = await api.createCard({
      'day': todayKey(),
      'title': 'Görsel yükleme testi',
      'color': 'teal',
    });

    // 1x1 PNG — sunucu sharp ile webp'e çevirip küçük önizleme üretir.
    final png = base64Decode(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    );

    final uploaded = await api.uploadImages(card.id, [
      (name: 'test.png', bytes: png),
    ]);
    expect(uploaded, hasLength(1));
    expect(uploaded.first.thumbUrl, contains('.thumb.webp'));
    // ignore: avoid_print
    print('yüklendi: ${uploaded.first.url}');

    // Kart yeniden çekilince görsel görünmeli
    final refreshed = (await api.cards(
      card.day,
      card.day,
    )).firstWhere((c) => c.id == card.id);
    expect(refreshed.images, hasLength(1));

    await api.deleteImage(uploaded.first.id);
    final cleaned = (await api.cards(
      card.day,
      card.day,
    )).firstWhere((c) => c.id == card.id);
    expect(cleaned.images, isEmpty);

    await api.deleteCard(card.id);
  });
}
