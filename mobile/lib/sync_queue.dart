import 'dart:convert';
import 'api/models.dart';

/// A durable write, including the original card and a rejected server version.
class PendingWrite {
  PendingWrite({
    required this.id,
    required this.method,
    required this.path,
    this.body,
    this.baseCard,
    this.failure,
  });
  final int id;
  final String method;
  final String path;
  final Map<String, dynamic>? body;
  final Map<String, dynamic>? baseCard;
  final Map<String, dynamic>? failure;

  factory PendingWrite.fromRow(Map<String, Object?> row) {
    Map<String, dynamic>? decode(String key) => row[key] == null
        ? null
        : jsonDecode(row[key] as String) as Map<String, dynamic>;
    return PendingWrite(
      id: row['id'] as int,
      method: row['method'] as String,
      path: row['path'] as String,
      body: decode('body'),
      baseCard: decode('base_card'),
      failure: decode('failure'),
    );
  }

  String? get cardId => path == '/cards'
      ? (body?['id'] as String?)
      : RegExp(r'^/cards/([^/]+)').firstMatch(path)?.group(1);
  PlannerCard? get serverCard => failure?['card'] is Map
      ? PlannerCard.fromJson(Map<String, dynamic>.from(failure!['card'] as Map))
      : null;
  bool get conflict => failure?['error'] == 'stale_write' && serverCard != null;
  PlannerCard? get original =>
      baseCard == null ? null : PlannerCard.fromJson(baseCard!);
  PlannerCard? get draft =>
      baseCard == null && serverCard == null && path != '/cards'
      ? null
      : PlannerCard.fromJson({
          ...?(baseCard ?? serverCard?.toJson() ?? body),
          ...?body,
          'id': cardId,
        });
}
