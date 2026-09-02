import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/api/models.dart';
import 'package:planner/app_logger.dart';

void main() {
  final logs = <Map<String, Object?>>[];

  setUp(() {
    logs.clear();
    AppLogger.sink = logs.add;
  });

  tearDown(() => AppLogger.sink = null);

  test('Bearer, JSON ve request id başlıklarını gönderir', () async {
    late http.Request captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response(
        jsonEncode({
          'user': {
            'id': 'u1',
            'email': 'user@example.com',
            'name': 'User',
            'role': 'user',
          },
        }),
        200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'server-42',
        },
      );
    });
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      accessToken: 'access-jwt',
      client: client,
    );

    final user = await api.me();

    expect(user.email, 'user@example.com');
    expect(captured.headers['authorization'], 'Bearer access-jwt');
    expect(captured.headers['x-request-id'], startsWith('flutter-'));
    expect(logs.last, containsPair('requestId', 'server-42'));
    api.close();
  });

  test('aktif pano başlığını gönderir ve pano listesini ayrıştırır', () async {
    late http.Request captured;
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      accessToken: 'access-jwt',
      activeBoardId: 'board-42',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'boards': [
              {
                'id': 'board-42',
                'name': 'Ürün ekibi',
                'role': 'editor',
                'personal': false,
                'memberCount': 3,
              },
            ],
          }),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final boards = await api.boards();

    expect(captured.headers['x-board-id'], 'board-42');
    expect(boards.single.name, 'Ürün ekibi');
    expect(boards.single.canEdit, isTrue);
    api.close();
  });

  test(
    'kart etkinlik geçmişini kullanıcı ve ayrıntılarıyla ayrıştırır',
    () async {
      late http.Request captured;
      final api = ApiClient(
        baseUrl: 'https://planner.example',
        activeBoardId: 'board-42',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({
              'activities': [
                {
                  'id': 'activity-1',
                  'boardId': 'board-42',
                  'cardId': 'card-1',
                  'actor': {
                    'id': 'u1',
                    'name': 'User',
                    'email': 'user@example.com',
                  },
                  'action': 'moved',
                  'cardTitle': 'Toplantı',
                  'details': {'fromDay': '2026-09-01', 'toDay': '2026-09-02'},
                  'createdAt': '2026-09-02T10:00:00.000Z',
                },
              ],
              'nextCursor': null,
            }),
            200,
            headers: {'content-type': 'application/json; charset=utf-8'},
          );
        }),
      );

      final result = await api.cardActivity(cardId: 'card-1');

      expect(captured.url.path, '/api/v1/activity');
      expect(captured.url.queryParameters['cardId'], 'card-1');
      expect(result.activities.single.action, 'moved');
      expect(result.activities.single.actorEmail, 'user@example.com');
      api.close();
    },
  );

  test('API hatası kod ve sunucu request id değeriyle taşınır', () async {
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      client: MockClient(
        (_) async => http.Response(
          jsonEncode({'error': 'invalid_credentials'}),
          401,
          headers: {'x-request-id': 'failed-7'},
        ),
      ),
    );

    final future = api.login('user@example.com', 'wrong');

    await expectLater(
      future,
      throwsA(
        isA<ApiException>()
            .having((error) => error.code, 'code', 'invalid_credentials')
            .having((error) => error.requestId, 'requestId', 'failed-7'),
      ),
    );
    expect(logs, contains(containsPair('event', 'api_request_rejected')));
    api.close();
  });

  test('kullanıcının etiket önerilerini tags endpointinden alır', () async {
    late http.Request captured;
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'tags': ['Backend', 'Mobil'],
          }),
          200,
        );
      }),
    );

    expect(await api.tags(), ['Backend', 'Mobil']);
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/tags');
    api.close();
  });

  test('kart arama sorgusunu güvenli query parametresiyle gönderir', () async {
    late http.Request captured;
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      client: MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'query': 'proje sunumu',
            'cards': [
              {'id': 'card-1', 'day': '2026-08-18', 'title': 'Proje sunumu'},
            ],
          }),
          200,
        );
      }),
    );

    final cards = await api.searchCards('proje sunumu');
    expect(cards.single.title, 'Proje sunumu');
    expect(captured.url.path, '/api/v1/cards/search');
    expect(captured.url.queryParameters['q'], 'proje sunumu');
    api.close();
  });

  test(
    'arşiv ve çöp kutusu endpointlerini doğru yöntemlerle çağırır',
    () async {
      final calls = <String>[];
      final api = ApiClient(
        baseUrl: 'https://planner.example',
        client: MockClient((request) async {
          calls.add('${request.method} ${request.url.path}');
          if (request.url.path.endsWith('/restore')) {
            return http.Response(
              jsonEncode({
                'card': {'id': 'card-1', 'day': '2026-08-25'},
              }),
              200,
            );
          }
          if (request.method == 'GET') {
            return http.Response(jsonEncode({'cards': []}), 200);
          }
          return http.Response(jsonEncode({'ok': true}), 200);
        }),
      );

      expect(await api.archivedCards(), isEmpty);
      expect(await api.trashedCards(), isEmpty);
      await api.archiveCard('card-1');
      expect((await api.restoreCard('card-1')).id, 'card-1');
      await api.permanentlyDeleteCard('card-1');

      expect(calls, [
        'GET /api/v1/cards/archived',
        'GET /api/v1/cards/trash',
        'POST /api/v1/cards/card-1/archive',
        'POST /api/v1/cards/card-1/restore',
        'DELETE /api/v1/cards/card-1/permanent',
      ]);
      api.close();
    },
  );

  test(
    'kart çoğaltma ve görselli şablon endpointlerini doğru çağırır',
    () async {
      final calls = <String>[];
      final api = ApiClient(
        baseUrl: 'https://planner.example',
        client: MockClient((request) async {
          calls.add('${request.method} ${request.url.path}');
          if (request.url.path.endsWith('/duplicate')) {
            return http.Response(
              jsonEncode({
                'card': {
                  'id': 'card-copy',
                  'day': '2026-08-27',
                  'images': [
                    {
                      'id': 'image-copy',
                      'url': '/uploads/shared.webp',
                      'thumbUrl': '/uploads/shared.thumb.webp',
                      'width': 800,
                      'height': 600,
                    },
                  ],
                },
              }),
              201,
            );
          }
          if (request.method == 'GET') {
            return http.Response(
              jsonEncode({
                'templates': [
                  {
                    'id': 'template-1',
                    'name': 'Görselli',
                    'images': [
                      {
                        'id': 'template-image',
                        'url': '/uploads/shared.webp',
                        'thumbUrl': '/uploads/shared.thumb.webp',
                        'width': 800,
                        'height': 600,
                      },
                    ],
                  },
                ],
              }),
              200,
            );
          }
          return http.Response(jsonEncode({'ok': true}), 200);
        }),
      );

      expect(
        (await api.duplicateCard('card-1')).images.single.id,
        'image-copy',
      );
      expect(
        (await api.cardTemplates()).single.images.single.id,
        'template-image',
      );
      await api.deleteCardTemplate('template-1');
      expect(calls, [
        'POST /api/v1/cards/card-1/duplicate',
        'GET /api/v1/card-templates',
        'DELETE /api/v1/card-templates/template-1',
      ]);
      api.close();
    },
  );

  test('aktarım dosyasını indirir ve multipart olarak içe aktarır', () async {
    final calls = <http.Request>[];
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      accessToken: 'access-jwt',
      client: MockClient((request) async {
        calls.add(request);
        if (request.method == 'GET') {
          return http.Response(
            '{"cards":[]}',
            200,
            headers: {
              'content-disposition':
                  'attachment; filename="easy-plan-2026-08.json"',
            },
          );
        }
        return http.Response(
          jsonEncode({'imported': 2, 'skipped': 1, 'errors': []}),
          201,
        );
      }),
    );

    final exported = await api.exportData('json', '2026-08-01', '2026-08-31');
    expect(exported.filename, 'easy-plan-2026-08.json');
    expect(utf8.decode(exported.bytes), '{"cards":[]}');
    final imported = await api.importData(
      'plan.json',
      Uint8List.fromList(utf8.encode('{"cards":[]}')),
    );
    expect(imported.imported, 2);
    expect(imported.skipped, 1);
    expect(calls.first.url.queryParameters, {
      'format': 'json',
      'from': '2026-08-01',
      'to': '2026-08-31',
    });
    expect(calls.last.method, 'POST');
    expect(calls.last.url.path, '/api/v1/data/import');
    expect(
      calls.last.headers['content-type'],
      startsWith('multipart/form-data'),
    );
    api.close();
  });

  test('zaman aşımı ağ hatası olarak loglanır', () async {
    final api = ApiClient(
      baseUrl: 'https://planner.example',
      timeout: const Duration(milliseconds: 5),
      client: MockClient((_) async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return http.Response('{}', 200);
      }),
    );

    await expectLater(api.me(), throwsA(isA<TimeoutException>()));
    expect(logs, contains(containsPair('event', 'api_network_error')));
    api.close();
  });

  test(
    '401 sonrası refresh JWT döndürür, güvenli kayıt callbackini çağırır ve isteği tekrarlar',
    () async {
      var calls = 0;
      String? storedAccess;
      String? storedRefresh;
      final api = ApiClient(
        baseUrl: 'https://planner.example',
        accessToken: 'expired-access',
        refreshToken: 'refresh-1',
        onTokensChanged: (access, refresh) {
          storedAccess = access;
          storedRefresh = refresh;
        },
        client: MockClient((request) async {
          calls += 1;
          if (request.url.path.endsWith('/auth/refresh')) {
            expect(jsonDecode(request.body), {'refreshToken': 'refresh-1'});
            return http.Response(
              jsonEncode({
                'accessToken': 'access-2',
                'refreshToken': 'refresh-2',
              }),
              200,
            );
          }
          if (calls == 1) {
            return http.Response(jsonEncode({'error': 'unauthorized'}), 401);
          }
          expect(request.headers['authorization'], 'Bearer access-2');
          return http.Response(
            jsonEncode({
              'user': {
                'id': 'u1',
                'email': 'user@example.com',
                'name': 'User',
                'role': 'user',
              },
            }),
            200,
          );
        }),
      );

      final user = await api.me();

      expect(user.email, 'user@example.com');
      expect(calls, 3);
      expect(storedAccess, 'access-2');
      expect(storedRefresh, 'refresh-2');
      expect(api.accessToken, 'access-2');
      expect(api.refreshToken, 'refresh-2');
      api.close();
    },
  );

  test(
    'geçersiz refresh JWT native oturumu temizleme callbackini çağırır',
    () async {
      var authenticationFailed = false;
      final api = ApiClient(
        baseUrl: 'https://planner.example.com',
        accessToken: 'expired-access',
        refreshToken: 'invalid-refresh',
        onAuthenticationFailed: () => authenticationFailed = true,
        client: MockClient((request) async {
          if (request.url.path.endsWith('/auth/refresh')) {
            return http.Response('{"error":"invalid_refresh"}', 401);
          }
          return http.Response('{"error":"unauthorized"}', 401);
        }),
      );

      await expectLater(api.me(), throwsA(isA<ApiException>()));
      expect(authenticationFailed, isTrue);
      expect(api.accessToken, isNull);
      expect(api.refreshToken, isNull);
    },
  );
}
