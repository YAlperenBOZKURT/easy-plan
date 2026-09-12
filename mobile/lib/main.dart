import 'dart:async';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'app_logger.dart';
import 'accessibility.dart';
import 'pages/login_page.dart';
import 'pages/planner_page.dart';
import 'notifications.dart';
import 'store.dart';
import 'theme.dart';
import 'localization.dart';

void main() {
  runZonedGuarded(() async {
    WidgetsFlutterBinding.ensureInitialized();
    FlutterError.onError = (details) {
      FlutterError.presentError(details);
      AppLogger.error(
        'flutter_framework_error',
        details.exception,
        details.stack ?? StackTrace.current,
      );
    };
    PlatformDispatcher.instance.onError = (error, stack) {
      AppLogger.error('platform_error', error, stack);
      return true;
    };
    ErrorWidget.builder = (details) => Directionality(
      textDirection: TextDirection.ltr,
      child: ColoredBox(
        color: const Color(0xfff7f7f8),
        child: Center(
          child: Text(
            'Beklenmeyen bir sorun oluştu.',
            style: const TextStyle(color: Color(0xffb42318)),
          ),
        ),
      ),
    );

    await Notifications.instance
        .init(); // izin ve saat dilimi hazırlığı (telefonda)
    runApp(PlannerApp(store: PlannerStore()..bootstrap()));
    AppLogger.info('application_started');
  }, (error, stack) => AppLogger.error('uncaught_zone_error', error, stack));
}

class PlannerApp extends StatelessWidget {
  const PlannerApp({super.key, required this.store});
  final PlannerStore store;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: store,
      builder: (context, _) => MaterialApp(
        title: 'Easy Plan',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(Brightness.light),
        darkTheme: buildTheme(Brightness.dark),
        themeMode: ThemeMode.system,
        locale: store.appLocale,
        supportedLocales: supportedAppLocales,
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        builder: (context, child) {
          final media = MediaQuery.of(context);
          final systemTextScale = media.textScaler.scale(1);
          final effectiveTextScale =
              (systemTextScale * store.textDensity.scaleFactor).clamp(.8, 3.2);
          final disableAnimations = store.motionPreference.resolve(
            systemReducedMotion: media.disableAnimations,
          );
          return AppLanguageScope(
            locale: store.appLocale,
            child: MediaQuery(
              data: media.copyWith(
                disableAnimations: disableAnimations,
                textScaler: TextScaler.linear(effectiveTextScale),
              ),
              child: child ?? const SizedBox.shrink(),
            ),
          );
        },
        home: Builder(builder: (context) {
          if (store.booting) {
            return const Scaffold(
              body: Center(child: CircularProgressIndicator()),
            );
          }
          return store.user == null
              ? LoginPage(store: store)
              : PlannerPage(store: store);
        }),
      ),
    );
  }
}
