/// Sunucudaki DTO'ların (server/src/dto.ts) Dart karşılıkları.
library;

class CardImage {
  CardImage({
    required this.id,
    required this.url,
    required this.thumbUrl,
    required this.width,
    required this.height,
  });

  final String id;
  final String url;
  final String thumbUrl;
  final int width;
  final int height;

  Map<String, dynamic> toJson() => {
    'id': id,
    'url': url,
    'thumbUrl': thumbUrl,
    'width': width,
    'height': height,
  };

  factory CardImage.fromJson(Map<String, dynamic> json) => CardImage(
    id: json['id'] as String,
    url: json['url'] as String,
    thumbUrl: json['thumbUrl'] as String,
    width: (json['width'] as num?)?.toInt() ?? 0,
    height: (json['height'] as num?)?.toInt() ?? 0,
  );
}

class ChecklistItem {
  const ChecklistItem({
    required this.id,
    required this.text,
    required this.done,
  });

  final String id;
  final String text;
  final bool done;

  ChecklistItem copyWith({String? text, bool? done}) => ChecklistItem(
    id: id,
    text: text ?? this.text,
    done: done ?? this.done,
  );

  Map<String, dynamic> toJson() => {'id': id, 'text': text, 'done': done};

  factory ChecklistItem.fromJson(Map<String, dynamic> json) => ChecklistItem(
    id: json['id'] as String,
    text: (json['text'] as String?) ?? '',
    done: json['done'] == true,
  );
}

bool isChecklistComplete(List<ChecklistItem> items) =>
    items.isNotEmpty && items.every((item) => item.done);

class PlannerCard {
  PlannerCard({
    required this.id,
    required this.day,
    required this.title,
    required this.note,
    required this.startTime,
    required this.endTime,
    required this.color,
    required this.done,
    required this.sortIndex,
    required this.manualSort,
    required this.habitId,
    this.checklist = const [],
    required this.reminders,
    required this.images,
    required this.updatedAt,
  });

  final String id;
  final String day; // 'YYYY-MM-DD'
  final String title;
  final String note;
  final String? startTime; // 'HH:MM'
  final String? endTime;
  final String color;
  final bool done;
  final double sortIndex;
  final bool manualSort;
  final String? habitId;
  final List<ChecklistItem> checklist;
  final List<int> reminders;
  final List<CardImage> images;
  final String updatedAt;

  bool get hasTime => startTime != null && startTime!.isNotEmpty;

  String get timeLabel {
    if (!hasTime) return '';
    return endTime == null || endTime!.isEmpty
        ? startTime!
        : '$startTime - $endTime';
  }

  /// Yerel önbelleğe olduğu gibi yazılır (bkz. cache.dart).
  Map<String, dynamic> toJson() => {
    'id': id,
    'day': day,
    'title': title,
    'note': note,
    'startTime': startTime,
    'endTime': endTime,
    'color': color,
    'done': done,
    'sortIndex': sortIndex,
    'manualSort': manualSort,
    'habitId': habitId,
    'checklist': checklist.map((item) => item.toJson()).toList(),
    'reminders': reminders,
    'images': images.map((i) => i.toJson()).toList(),
    'updatedAt': updatedAt,
  };

  /// Çevrimdışı düzenlemede yerel kopyayı anında güncellemek için.
  PlannerCard copyWith({
    String? day,
    String? title,
    String? note,
    String? startTime,
    String? endTime,
    String? color,
    bool? done,
    double? sortIndex,
    List<int>? reminders,
    List<ChecklistItem>? checklist,
    String? updatedAt,
  }) => PlannerCard(
    id: id,
    day: day ?? this.day,
    title: title ?? this.title,
    note: note ?? this.note,
    startTime: startTime ?? this.startTime,
    endTime: endTime ?? this.endTime,
    color: color ?? this.color,
    done: done ?? this.done,
    sortIndex: sortIndex ?? this.sortIndex,
    manualSort: manualSort,
    habitId: habitId,
    checklist: checklist ?? this.checklist,
    reminders: reminders ?? this.reminders,
    images: images,
    updatedAt: updatedAt ?? this.updatedAt,
  );

  factory PlannerCard.fromJson(Map<String, dynamic> json) => PlannerCard(
    id: json['id'] as String,
    day: json['day'] as String,
    title: (json['title'] as String?) ?? '',
    note: (json['note'] as String?) ?? '',
    startTime: json['startTime'] as String?,
    endTime: json['endTime'] as String?,
    color: (json['color'] as String?) ?? 'blue',
    done: json['done'] == true,
    sortIndex: (json['sortIndex'] as num?)?.toDouble() ?? 0,
    manualSort: json['manualSort'] == true,
    habitId: json['habitId'] as String?,
    checklist: ((json['checklist'] as List?) ?? [])
        .map((item) => ChecklistItem.fromJson(item as Map<String, dynamic>))
        .toList(),
    reminders: ((json['reminders'] as List?) ?? [])
        .map((e) => (e as num).toInt())
        .toList(),
    images: ((json['images'] as List?) ?? [])
        .map((e) => CardImage.fromJson(e as Map<String, dynamic>))
        .toList(),
    updatedAt: (json['updatedAt'] as String?) ?? '',
  );
}

class Habit {
  Habit({
    required this.id,
    required this.title,
    required this.color,
    required this.weekdays,
    required this.reminders,
    required this.startTime,
  });

  final String id;
  final String title;
  final String color;
  final List<int> weekdays;
  final List<int> reminders;
  final String? startTime;

  factory Habit.fromJson(Map<String, dynamic> json) => Habit(
    id: json['id'] as String,
    title: (json['title'] as String?) ?? '',
    color: (json['color'] as String?) ?? 'violet',
    weekdays: ((json['weekdays'] as List?) ?? [])
        .map((e) => (e as num).toInt())
        .toList(),
    reminders: ((json['reminders'] as List?) ?? [])
        .map((e) => (e as num).toInt())
        .toList(),
    startTime: json['startTime'] as String?,
  );
}

class PlannerUser {
  PlannerUser({
    required this.id,
    required this.email,
    required this.name,
    required this.role,
  });

  final String id;
  final String email;
  final String name;
  final String role;

  bool get isAdmin => role == 'admin';

  factory PlannerUser.fromJson(Map<String, dynamic> json) => PlannerUser(
    id: json['id'] as String,
    email: json['email'] as String,
    name: (json['name'] as String?) ?? '',
    role: (json['role'] as String?) ?? 'user',
  );
}

/// Sunucunun döndürdüğü hata kodlarını taşır (invalid_credentials, out_of_window…).
class ApiException implements Exception {
  ApiException(this.statusCode, this.code, {this.requestId});
  final int statusCode;
  final String code;
  final String? requestId;

  @override
  String toString() =>
      'ApiException($statusCode, $code, requestId: $requestId)';
}
