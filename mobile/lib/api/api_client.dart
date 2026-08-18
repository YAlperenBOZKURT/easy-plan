import 'dart:convert';
import 'dart:async';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';

import '../app_logger.dart';
import 'models.dart';

/// Sunucuyla konuşan tek katman.
///
/// Web arayüzü HttpOnly cookie kullanır; native istemci kısa ömürlü access JWT
/// ve dönen refresh JWT çiftini güvenli depoda saklar.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    this.accessToken,
    this.refreshToken,
    this.onTokensChanged,
    this.onAuthenticationFailed,
    http.Client? client,
    this.timeout = const Duration(seconds: 20),
  }) : _http = client ?? http.Client();

  /// Örn. http://192.168.1.20:3000 ya da https://planner.example.com
  String baseUrl;
  String? accessToken;
  String? refreshToken;
  final FutureOr<void> Function(String accessToken, String refreshToken)?
  onTokensChanged;
  final FutureOr<void> Function()? onAuthenticationFailed;
  final Duration timeout;

  final http.Client _http;
  Future<void>? _refreshInFlight;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('$baseUrl/api/v1$path').replace(queryParameters: query);

  /// content-type YALNIZCA gövde varken gönderilir: gövdesiz bir DELETE'e
  /// application/json demek Fastify tarafında "boş gövde" hatası (400) üretiyor.
  Map<String, String> _headers({bool withBody = false, String? requestId}) {
    final headers = <String, String>{};
    if (withBody) headers['content-type'] = 'application/json';
    if (accessToken case final token?) {
      headers['authorization'] = 'Bearer $token';
    }
    if (requestId case final requestId?) headers['x-request-id'] = requestId;
    return headers;
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    bool allowRefresh = true,
  }) async {
    final clientRequestId = 'flutter-${DateTime.now().microsecondsSinceEpoch}';
    final stopwatch = Stopwatch()..start();
    final request = http.Request(method, _uri(path, query))
      ..headers.addAll(
        _headers(withBody: body != null, requestId: clientRequestId),
      );
    if (body != null) request.body = jsonEncode(body);

    late http.Response response;
    try {
      final streamed = await _http.send(request).timeout(timeout);
      response = await http.Response.fromStream(streamed);
    } catch (error, stack) {
      AppLogger.error(
        'api_network_error',
        error,
        stack,
        context: {
          'method': method,
          'path': _safePath(path),
          'requestId': clientRequestId,
          'durationMs': stopwatch.elapsedMilliseconds,
        },
      );
      rethrow;
    }
    final serverRequestId = response.headers['x-request-id'] ?? clientRequestId;
    AppLogger.debug(
      'api_request_completed',
      context: {
        'method': method,
        'path': _safePath(path),
        'status': response.statusCode,
        'requestId': serverRequestId,
        'durationMs': stopwatch.elapsedMilliseconds,
      },
    );

    dynamic decoded;
    if (response.body.isNotEmpty) {
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {
        decoded = null;
      }
    }

    if (response.statusCode == 401 &&
        allowRefresh &&
        refreshToken != null &&
        !_isPublicAuthPath(path)) {
      await _refreshTokens();
      return _send(method, path, query: query, body: body, allowRefresh: false);
    }

    if (response.statusCode >= 400) {
      final code = decoded is Map && decoded['error'] is String
          ? decoded['error'] as String
          : 'http_${response.statusCode}';
      AppLogger.warning(
        'api_request_rejected',
        context: {
          'method': method,
          'path': _safePath(path),
          'status': response.statusCode,
          'code': code,
          'requestId': serverRequestId,
        },
      );
      throw ApiException(response.statusCode, code, requestId: serverRequestId);
    }
    return decoded;
  }

  /* ----------------------------------------------------------- kimlik */

  Future<({String accessToken, String refreshToken, PlannerUser user})> login(
    String email,
    String password,
  ) async {
    final json =
        await _send(
              'POST',
              '/auth/token',
              body: {'email': email, 'password': password, 'device': 'Flutter'},
            )
            as Map<String, dynamic>;
    return (
      accessToken: json['accessToken'] as String,
      refreshToken: json['refreshToken'] as String,
      user: PlannerUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }

  Future<void> _refreshTokens() {
    final running = _refreshInFlight;
    if (running != null) return running;
    final future = _performRefresh();
    _refreshInFlight = future;
    return future.whenComplete(() => _refreshInFlight = null);
  }

  Future<void> _performRefresh() async {
    final current = refreshToken;
    if (current == null) throw ApiException(401, 'refresh_required');
    late final Map<String, dynamic> json;
    try {
      json =
          await _send(
                'POST',
                '/auth/refresh',
                body: {'refreshToken': current},
                allowRefresh: false,
              )
              as Map<String, dynamic>;
    } on ApiException catch (error) {
      if (error.statusCode == 401) {
        accessToken = null;
        refreshToken = null;
        await onAuthenticationFailed?.call();
      }
      rethrow;
    }
    final nextAccess = json['accessToken'] as String;
    final nextRefresh = json['refreshToken'] as String;
    accessToken = nextAccess;
    refreshToken = nextRefresh;
    await onTokensChanged?.call(nextAccess, nextRefresh);
  }

  Future<PlannerUser> me() async {
    final json = await _send('GET', '/auth/me') as Map<String, dynamic>;
    return PlannerUser.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<void> logout() => _send(
    'POST',
    '/auth/logout',
    body: {if (refreshToken != null) 'refreshToken': refreshToken},
    allowRefresh: false,
  );

  /* ----------------------------------------------------------- kartlar */

  Future<List<PlannerCard>> cards(String from, String to) async {
    final json =
        await _send('GET', '/cards', query: {'from': from, 'to': to})
            as Map<String, dynamic>;
    return (json['cards'] as List)
        .map((e) => PlannerCard.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<List<String>> tags() async {
    final json = await _send('GET', '/tags') as Map<String, dynamic>;
    return (json['tags'] as List).cast<String>();
  }

  Future<PlannerCard> createCard(Map<String, dynamic> input) async {
    final json =
        await _send('POST', '/cards', body: input) as Map<String, dynamic>;
    return PlannerCard.fromJson(json['card'] as Map<String, dynamic>);
  }

  Future<PlannerCard> updateCard(String id, Map<String, dynamic> patch) async {
    final json =
        await _send('PATCH', '/cards/$id', body: patch) as Map<String, dynamic>;
    return PlannerCard.fromJson(json['card'] as Map<String, dynamic>);
  }

  Future<void> deleteCard(String id) => _send('DELETE', '/cards/$id');

  Future<PlannerCard> moveCard(
    String id, {
    required String day,
    String? beforeId,
    String? afterId,
  }) async {
    final json =
        await _send(
              'PATCH',
              '/cards/$id/move',
              body: {'day': day, 'beforeId': beforeId, 'afterId': afterId},
            )
            as Map<String, dynamic>;
    return PlannerCard.fromJson(json['card'] as Map<String, dynamic>);
  }

  /// Kuyruktaki çevrimdışı isteklerin tekrar gönderimi için genel giriş.
  Future<dynamic> raw(
    String method,
    String path, {
    Map<String, dynamic>? body,
  }) => _send(method, path, body: body);

  void close() => _http.close();

  /* --------------------------------------------------------- görseller */

  /// Karta görsel yükler. Sunucu sharp ile küçültüp webp'e çevirir.
  Future<List<CardImage>> uploadImages(
    String cardId,
    List<({String name, Uint8List bytes})> files,
  ) => _uploadImages(cardId, files, allowRefresh: true);

  Future<List<CardImage>> _uploadImages(
    String cardId,
    List<({String name, Uint8List bytes})> files, {
    required bool allowRefresh,
  }) async {
    final clientRequestId = 'flutter-${DateTime.now().microsecondsSinceEpoch}';
    final request = http.MultipartRequest(
      'POST',
      _uri('/cards/$cardId/images'),
    );
    request.headers.addAll(_headers(requestId: clientRequestId));
    for (final file in files) {
      request.files.add(
        http.MultipartFile.fromBytes(
          'file',
          file.bytes,
          filename: file.name,
          contentType: _mediaType(file.name),
        ),
      );
    }
    final response = await http.Response.fromStream(await request.send());
    if (response.statusCode == 401 && allowRefresh && refreshToken != null) {
      await _refreshTokens();
      return _uploadImages(cardId, files, allowRefresh: false);
    }
    if (response.statusCode >= 400) {
      dynamic decoded;
      try {
        decoded = jsonDecode(response.body);
      } catch (_) {}
      final code = decoded is Map && decoded['error'] is String
          ? decoded['error'] as String
          : 'http_${response.statusCode}';
      throw ApiException(
        response.statusCode,
        code,
        requestId: response.headers['x-request-id'] ?? clientRequestId,
      );
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['images'] as List)
        .map((e) => CardImage.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> deleteImage(String id) => _send('DELETE', '/images/$id');

  static MediaType _mediaType(String filename) {
    final ext = filename.toLowerCase().split('.').last;
    return switch (ext) {
      'png' => MediaType('image', 'png'),
      'webp' => MediaType('image', 'webp'),
      'gif' => MediaType('image', 'gif'),
      'heic' => MediaType('image', 'heic'),
      'heif' => MediaType('image', 'heif'),
      _ => MediaType('image', 'jpeg'),
    };
  }

  /* --------------------------------------------------------- davranış */

  Future<List<Habit>> habits() async {
    final json = await _send('GET', '/habits') as Map<String, dynamic>;
    return (json['habits'] as List)
        .map((e) => Habit.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /* ---------------------------------------------------------- senkron */

  /// Delta senkron: `since` verilmezse tam kopya döner.
  Future<
    ({
      String serverTime,
      List<PlannerCard> cards,
      List<Map<String, dynamic>> deletions,
    })
  >
  changes({String? since}) async {
    final json =
        await _send(
              'GET',
              '/changes',
              query: since == null ? null : {'since': since},
            )
            as Map<String, dynamic>;
    return (
      serverTime: json['serverTime'] as String,
      cards: (json['cards'] as List)
          .map((e) => PlannerCard.fromJson(e as Map<String, dynamic>))
          .toList(),
      deletions: (json['deletions'] as List).cast<Map<String, dynamic>>(),
    );
  }

  /// Görseller oturum arkasında servis edilir; jetonu sorgu yerine başlıkla göndeririz.
  Map<String, String> get imageHeaders => _headers();

  String imageUrl(String path) => '$baseUrl$path';

  static String _safePath(String path) =>
      path.replaceAll(RegExp(r'/(invite|reset)/[^/?]+'), r'/$1/[redacted]');

  static bool _isPublicAuthPath(String path) =>
      RegExp(r'^/auth/(token|refresh|invite/|forgot|reset/)').hasMatch(path);
}
