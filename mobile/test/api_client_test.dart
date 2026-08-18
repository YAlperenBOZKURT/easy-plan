import 'dart:async';
import 'dart:convert';

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
        return http.Response(jsonEncode({'tags': ['Backend', 'Mobil']}), 200);
      }),
    );

    expect(await api.tags(), ['Backend', 'Mobil']);
    expect(captured.method, 'GET');
    expect(captured.url.path, '/api/v1/tags');
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
