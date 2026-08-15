import 'dart:io' show Platform;

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_timezone/flutter_timezone.dart';
import 'package:timezone/data/latest_all.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

import 'api/models.dart';
import 'app_logger.dart';
import 'dates.dart';

/// Kart hatırlatmalarını telefonda yerel bildirime çevirir.
///
/// Sunucu aynı hatırlatmaları e-posta olarak da gönderir; buradaki bildirim
/// ona ek bir katman. Uygulama çevrimdışı olsa bile planlanmış bildirimler
/// çalar, çünkü zamanlama işletim sistemine bırakılır.
class Notifications {
  Notifications._();
  static final instance = Notifications._();

  final _plugin = FlutterLocalNotificationsPlugin();
  bool _ready = false;

  /// Bildirim yalnızca telefonda kurulur; masaüstünde e-posta yeterli.
  static bool get supported =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  /// Saatsiz kartlarda sunucuyla aynı varsayılan: 09:00.
  static const defaultHour = 9;

  Future<void> init() async {
    if (!supported || _ready) return;
    try {
      tzdata.initializeTimeZones();
      final zone = await FlutterTimezone.getLocalTimezone();
      tz.setLocalLocation(tz.getLocation(zone.identifier));

      await _plugin.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(
            requestAlertPermission: true,
            requestBadgePermission: false,
            requestSoundPermission: true,
          ),
        ),
      );

      await _plugin
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >()
          ?.requestNotificationsPermission();

      _ready = true;
    } catch (error, stack) {
      AppLogger.error('notifications_init_failed', error, stack);
    }
  }

  /// Görünen kartların hatırlatmalarını yeniden planlar.
  ///
  /// Basit ve güvenli yol: hepsini iptal edip baştan kurmak. Kart sayısı
  /// (bir haftalık pencere) küçük olduğu için maliyeti yok denecek kadar az.
  Future<int> reschedule(Iterable<PlannerCard> cards) async {
    if (!supported || !_ready) return 0;
    try {
      await _plugin.cancelAll();
      final now = tz.TZDateTime.now(tz.local);
      var planned = 0;

      for (final card in cards) {
        if (card.done) continue; // yapılmış işe hatırlatma yok
        for (final offset in card.reminders) {
          final at = fireAtFor(card, offset);
          if (!at.isAfter(now)) continue;

          await _plugin.zonedSchedule(
            id: _idFor(card.id, offset),
            title: '${_offsetLabel(offset)} kaldı',
            body: card.title.isEmpty ? 'Planner' : card.title,
            scheduledDate: at,
            notificationDetails: NotificationDetails(
              android: AndroidNotificationDetails(
                'reminders',
                'Hatırlatmalar',
                channelDescription: 'Kart hatırlatmaları',
                importance: Importance.high,
                priority: Priority.high,
                styleInformation: card.note.isEmpty
                    ? null
                    : BigTextStyleInformation(card.note),
              ),
              iOS: const DarwinNotificationDetails(),
            ),
            // Kesin alarm izni istemeden çalışsın: dakika farkı önemli değil.
            androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
            payload: card.id,
          );
          planned += 1;
        }
      }
      return planned;
    } catch (error, stack) {
      AppLogger.error('notifications_schedule_failed', error, stack);
      return 0;
    }
  }

  /// Kartın günü + başlangıç saati (yoksa 09:00) − seçilen aralık.
  /// Sunucudaki hesapla aynı kural (server/src/reminders.ts).
  static tz.TZDateTime fireAtFor(PlannerCard card, int offsetMinutes) {
    final day = parseDay(card.day);
    var hour = defaultHour;
    var minute = 0;
    if (card.hasTime) {
      final parts = card.startTime!.split(':');
      hour = int.tryParse(parts.first) ?? defaultHour;
      minute = int.tryParse(parts.last) ?? 0;
    }
    final base = tz.TZDateTime(
      tz.local,
      day.year,
      day.month,
      day.day,
      hour,
      minute,
    );
    return base.subtract(Duration(minutes: offsetMinutes));
  }

  /// Kart kimliği + aralıktan kararlı 31-bit kimlik.
  static int _idFor(String cardId, int offset) =>
      (Object.hash(cardId, offset) & 0x7fffffff);

  static String _offsetLabel(int minutes) =>
      minutes % 1440 == 0 ? '${minutes ~/ 1440} gün' : '${minutes ~/ 60} saat';
}
