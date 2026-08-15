import 'dart:convert';
import 'dart:developer' as developer;

typedef LogSink = void Function(Map<String, Object?> record);

/// Mobil ve masaüstünde aynı yapılandırılmış log biçimini kullanır.
///
/// [sink] daha sonra Sentry/Crashlytics gibi bir servise bağlanabilir; uygulama
/// kodunun harici gözlemleme sağlayıcısına bağımlı olmasını engeller.
abstract final class AppLogger {
  static LogSink? sink;

  static void debug(String event, {Map<String, Object?> context = const {}}) =>
      _write('debug', 500, event, context: context);

  static void info(String event, {Map<String, Object?> context = const {}}) =>
      _write('info', 800, event, context: context);

  static void warning(
    String event, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?> context = const {},
  }) => _write(
    'warning',
    900,
    event,
    error: error,
    stackTrace: stackTrace,
    context: context,
  );

  static void error(
    String event,
    Object error,
    StackTrace stackTrace, {
    Map<String, Object?> context = const {},
  }) => _write(
    'error',
    1000,
    event,
    error: error,
    stackTrace: stackTrace,
    context: context,
  );

  static void _write(
    String level,
    int value,
    String event, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?> context = const {},
  }) {
    final record = <String, Object?>{
      'timestamp': DateTime.now().toUtc().toIso8601String(),
      'level': level,
      'event': event,
      ...context,
      if (error != null) 'error': error.toString(),
    };
    developer.log(
      jsonEncode(record),
      name: 'planner',
      level: value,
      error: error,
      stackTrace: stackTrace,
    );
    sink?.call(record);
  }
}
