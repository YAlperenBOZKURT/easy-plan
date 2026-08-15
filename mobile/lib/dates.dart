/// Tarih yardımcıları — gün anahtarı her yerde 'YYYY-MM-DD' (yerel saat).
library;

const _dayNames = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
];
const _dayShort = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const _months = [
  'Oca',
  'Şub',
  'Mar',
  'Nis',
  'May',
  'Haz',
  'Tem',
  'Ağu',
  'Eyl',
  'Eki',
  'Kas',
  'Ara',
];

String two(int n) => n.toString().padLeft(2, '0');

String dayKey(DateTime date) =>
    '${date.year}-${two(date.month)}-${two(date.day)}';

DateTime parseDay(String day) {
  final parts = day.split('-').map(int.parse).toList();
  return DateTime(parts[0], parts[1], parts[2]);
}

String addDays(String day, int n) =>
    dayKey(parseDay(day).add(Duration(days: n)));

String addYears(String day, int n) {
  final d = parseDay(day);
  return dayKey(DateTime(d.year + n, d.month, d.day));
}

String todayKey() => dayKey(DateTime.now());

/// 'Perşembe'
String dayName(String day) => _dayNames[parseDay(day).weekday - 1];

/// 'PER'
String dayNameShort(String day) => _dayShort[parseDay(day).weekday - 1];

int dayNumber(String day) => parseDay(day).day;

/// '14 Ağu'
String shortDate(String day) {
  final d = parseDay(day);
  return '${d.day} ${_months[d.month - 1]}';
}

/// '14 Ağu – 20 Ağu 2026'
String rangeLabel(String from, String to) =>
    '${shortDate(from)} – ${shortDate(to)} ${parseDay(to).year}';

const weekdayLabels = <({int value, String label})>[
  (value: 1, label: 'Pzt'),
  (value: 2, label: 'Sal'),
  (value: 3, label: 'Çar'),
  (value: 4, label: 'Per'),
  (value: 5, label: 'Cum'),
  (value: 6, label: 'Cmt'),
  (value: 7, label: 'Paz'),
];

/// Hatırlatma seçenekleri (dakika) — web ile aynı.
const reminderOptions = <({int minutes, String label})>[
  (minutes: 1440, label: '1 gün'),
  (minutes: 720, label: '12 saat'),
  (minutes: 360, label: '6 saat'),
  (minutes: 180, label: '3 saat'),
  (minutes: 60, label: '1 saat'),
];

const cardColorKeys = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'violet',
  'pink',
];
