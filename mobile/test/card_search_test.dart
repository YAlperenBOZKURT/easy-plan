import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:planner/api/api_client.dart';
import 'package:planner/cache.dart';
import 'package:planner/pages/card_search.dart';
import 'package:planner/store.dart';
import 'package:planner/theme.dart';

void main() {
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    await Cache.useInMemory();
  });

  testWidgets('arama penceresi sorguyu API endpointine gönderir', (tester) async {
    http.Request? captured;
    final store = PlannerStore()
      ..api = ApiClient(
        baseUrl: 'https://planner.example',
        client: MockClient((request) async {
          captured = request;
          return http.Response(
            jsonEncode({
              'query': 'proje',
              'cards': [
                {
                  'id': 'card-1',
                  'day': '2026-08-18',
                  'title': 'Proje sunumu',
                  'note': 'Müşteri taslağı',
                  'tags': ['İş'],
                },
              ],
            }),
            200,
          );
        }),
      );
    await tester.pumpWidget(
      MaterialApp(
        theme: buildTheme(Brightness.light),
        home: Builder(
          builder: (context) => Scaffold(
            body: FilledButton(
              onPressed: () async {
                await showCardSearch(context, store: store);
              },
              child: const Text('Aramayı aç'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Aramayı aç'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'proje');
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pump(const Duration(milliseconds: 300));
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 200)),
    );
    await tester.pump();

    expect(captured, isNotNull);
    expect(captured!.url.path, '/api/v1/cards/search');
    expect(captured!.url.queryParameters['q'], 'proje');

    await tester.tap(find.byTooltip('Kapat'));
    await tester.pumpAndSettle();
    store.api.close();
    store.dispose();
  });
}
