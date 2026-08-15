import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:planner/main.dart';
import 'package:planner/store.dart';

void main() {
  testWidgets('açılışta yükleniyor göstergesi çıkar', (tester) async {
    await tester.pumpWidget(PlannerApp(store: PlannerStore()));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('giriş ekranında sunucu adresi değiştirilemez', (tester) async {
    final store = PlannerStore()..booting = false;
    await tester.pumpWidget(PlannerApp(store: store));

    expect(find.text('Sunucu adresini değiştir'), findsNothing);
    expect(find.text('Sunucu adresi'), findsNothing);
    expect(find.text('Giriş yap'), findsOneWidget);
  });
}
