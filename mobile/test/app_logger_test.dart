import 'package:flutter_test/flutter_test.dart';
import 'package:planner/app_logger.dart';

void main() {
  test('logger sağlayıcıdan bağımsız yapılandırılmış kayıt üretir', () {
    Map<String, Object?>? captured;
    AppLogger.sink = (record) => captured = record;
    addTearDown(() => AppLogger.sink = null);

    AppLogger.info('sync_completed', context: {'count': 3});

    expect(captured, containsPair('level', 'info'));
    expect(captured, containsPair('event', 'sync_completed'));
    expect(captured, containsPair('count', 3));
    expect(captured?['timestamp'], isA<String>());
  });
}
