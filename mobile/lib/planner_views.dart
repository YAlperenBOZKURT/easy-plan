import 'dates.dart';

enum PlannerViewMode { week, month, agenda, completed }

String plannerViewLabel(PlannerViewMode view, {String languageCode = 'tr'}) => switch (view) {
  PlannerViewMode.week => languageCode == 'en' ? 'Week' : 'Hafta',
  PlannerViewMode.month => languageCode == 'en' ? 'Month' : 'Ay',
  PlannerViewMode.agenda => languageCode == 'en' ? 'Agenda' : 'Ajanda',
  PlannerViewMode.completed => languageCode == 'en' ? 'Completed' : 'Tamamlananlar',
};

String addMonths(String day, int amount) {
  final date = parseDay(day);
  final targetMonth = DateTime(date.year, date.month + amount, 1);
  final lastDay = DateTime(targetMonth.year, targetMonth.month + 1, 0).day;
  return dayKey(
    DateTime(
      targetMonth.year,
      targetMonth.month,
      date.day.clamp(1, lastDay),
    ),
  );
}

({String from, String to}) monthBounds(String day) {
  final date = parseDay(day);
  return (
    from: dayKey(DateTime(date.year, date.month, 1)),
    to: dayKey(DateTime(date.year, date.month + 1, 0)),
  );
}

({String from, String to}) monthGridBounds(String day) {
  final month = monthBounds(day);
  final before = parseDay(month.from).weekday - DateTime.monday;
  final after = DateTime.sunday - parseDay(month.to).weekday;
  return (
    from: addDays(month.from, -before),
    to: addDays(month.to, after),
  );
}

List<String> daysBetween(String from, String to) {
  final days = <String>[];
  for (var day = from; day.compareTo(to) <= 0; day = addDays(day, 1)) {
    days.add(day);
  }
  return days;
}

({String from, String to}) plannerRange(
  PlannerViewMode view,
  String anchor,
  int visibleDays,
) => switch (view) {
  PlannerViewMode.week => (
    from: anchor,
    to: addDays(anchor, visibleDays - 1),
  ),
  PlannerViewMode.month => monthGridBounds(anchor),
  PlannerViewMode.agenda || PlannerViewMode.completed => monthBounds(anchor),
};

String shiftPlannerAnchor(PlannerViewMode view, String anchor, int delta) =>
    view == PlannerViewMode.week
    ? addDays(anchor, delta)
    : addMonths(anchor, delta);

const _monthNames = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

String monthLabel(String day, {String languageCode = 'tr'}) {
  final date = parseDay(day);
  if (languageCode == 'en') {
    const englishMonths = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return '${englishMonths[date.month - 1]} ${date.year}';
  }
  return '${_monthNames[date.month - 1]} ${date.year}';
}
