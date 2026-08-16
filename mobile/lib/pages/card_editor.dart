import 'dart:io' show Platform;
import 'dart:typed_data';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/models.dart';
import '../cache.dart';
import '../dates.dart';
import '../deadline.dart';
import '../store.dart';
import '../theme.dart';

/// Kart düzenleyiciyi açar.
///
/// Geniş ekranda ortada duran bir pencere, telefonda alttan açılan sayfa —
/// web'deki modal davranışının aynısı. Kaydedilirse `true` döner.
Future<bool?> showCardEditor(
  BuildContext context, {
  required PlannerStore store,
  required String day,
  PlannerCard? card,
}) {
  final wide = MediaQuery.sizeOf(context).width >= 640;
  final editor = CardEditor(store: store, day: day, card: card);

  if (wide) {
    return showDialog<bool>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .45),
      builder: (_) => Dialog(
        backgroundColor: context.tokens.surface,
        insetPadding: const EdgeInsets.all(24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(R.xl),
          side: BorderSide(color: context.tokens.border),
        ),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 460,
            maxHeight: MediaQuery.sizeOf(context).height * .86,
          ),
          child: editor,
        ),
      ),
    );
  }

  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
    ),
    builder: (_) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(heightFactor: .92, child: editor),
    ),
  );
}

class CardEditor extends StatefulWidget {
  const CardEditor({
    super.key,
    required this.store,
    required this.day,
    this.card,
  });

  final PlannerStore store;
  final String day;
  final PlannerCard? card;

  @override
  State<CardEditor> createState() => _CardEditorState();
}

class _CardEditorState extends State<CardEditor> {
  late String _day = widget.card?.day ?? widget.day;
  late final _title = TextEditingController(text: widget.card?.title ?? '');
  late final _note = TextEditingController(text: widget.card?.note ?? '');
  late TimeOfDay? _start = _parse(widget.card?.startTime);
  late TimeOfDay? _end = _parse(widget.card?.endTime);
  late String _color = widget.card?.color ?? 'blue';
  late String _priority = widget.card?.priority ?? 'none';
  late DateTime? _deadline = widget.card?.deadlineAt == null
      ? null
      : DateTime.tryParse(widget.card!.deadlineAt!)?.toLocal();
  late final List<int> _reminders = [...?widget.card?.reminders];
  late final List<ChecklistItem> _checklist = [...?widget.card?.checklist];
  late List<CardImage> _images = [...?widget.card?.images];

  /// Yeni kartta görsel, kart kaydedildikten sonra yüklenir.
  final List<({String name, Uint8List bytes})> _pending = [];
  bool _resetOrder = false;
  bool _saving = false;

  static TimeOfDay? _parse(String? value) {
    if (value == null || value.isEmpty) return null;
    final parts = value.split(':');
    return TimeOfDay(hour: int.parse(parts[0]), minute: int.parse(parts[1]));
  }

  static String? _format(TimeOfDay? time) =>
      time == null ? null : '${two(time.hour)}:${two(time.minute)}';

  @override
  void dispose() {
    _title.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _pickTime({required bool start}) async {
    final picked = await showTimePicker(
      context: context,
      initialTime:
          (start ? _start : _end) ?? const TimeOfDay(hour: 9, minute: 0),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() => start ? _start = picked : _end = picked);
    }
  }

  Future<void> _pickDay() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: parseDay(_day),
      firstDate: parseDay(widget.store.minDay),
      lastDate: parseDay(widget.store.maxDay),
      locale: const Locale('tr'),
    );
    if (picked != null) setState(() => _day = dayKey(picked));
  }

  Future<void> _pickDeadline() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _deadline ?? parseDay(_day),
      firstDate: parseDay(widget.store.minDay),
      lastDate: parseDay(widget.store.maxDay),
      locale: const Locale('tr'),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: _deadline == null
          ? const TimeOfDay(hour: 18, minute: 0)
          : TimeOfDay.fromDateTime(_deadline!),
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (time == null || !mounted) return;
    setState(() {
      _deadline = DateTime(
        date.year,
        date.month,
        date.day,
        time.hour,
        time.minute,
      );
    });
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final saved = await widget.store.saveCard(
      existing: widget.card,
      day: _day,
      title: _title.text.trim(),
      note: _note.text.trim(),
      startTime: _format(_start),
      endTime: _format(_end),
      color: _color,
      priority: _priority,
      deadlineAt: _deadline?.toUtc().toIso8601String(),
      reminders: _reminders,
      checklist: _checklist
          .map((item) => item.copyWith(text: item.text.trim()))
          .where((item) => item.text.isNotEmpty)
          .toList(),
      resetOrder: _resetOrder,
    );
    // Kart oluştuktan sonra bekleyen görseller yüklenir.
    if (saved != null && _pending.isNotEmpty) {
      await widget.store.uploadImages(saved.id, _pending);
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  /// Galeriden ya da kameradan görsel seçer.
  Future<void> _pickImages({required ImageSource source}) async {
    final picker = ImagePicker();
    try {
      final picked = source == ImageSource.camera
          ? [
              if (await picker.pickImage(source: source, imageQuality: 92)
                  case final XFile f)
                f,
            ]
          : await picker.pickMultiImage(imageQuality: 92);
      if (picked.isEmpty) return;
      final loaded = <({String name, Uint8List bytes})>[];
      for (final file in picked) {
        loaded.add((name: file.name, bytes: await file.readAsBytes()));
      }
      if (mounted) setState(() => _pending.addAll(loaded));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(
          context,
        )?.showSnackBar(const SnackBar(content: Text('Görsel seçilemedi.')));
      }
    }
  }

  Future<void> _removeExisting(CardImage image) async {
    setState(() => _images = _images.where((i) => i.id != image.id).toList());
    await widget.store.deleteImage(image.id);
  }

  /// Masaüstünde kamera yok; yalnızca dosya seçtiriyoruz.
  bool get _cameraAvailable =>
      !kIsWeb && (Platform.isAndroid || Platform.isIOS);

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final allReminders = reminderOptions.map((o) => o.minutes).toList();
    final allOn = allReminders.every(_reminders.contains);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        /* ---- başlık çubuğu ---- */
        Container(
          padding: const EdgeInsets.fromLTRB(18, 14, 10, 14),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: t.border)),
          ),
          child: Row(
            children: [
              Text(
                widget.card == null ? 'Yeni kart' : 'Kartı düzenle',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: t.text,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '${dayName(_day)} · ${shortDate(_day)}',
                style: TextStyle(fontSize: 12.5, color: t.textFaint),
              ),
              const Spacer(),
              if (widget.card != null)
                IconButton(
                  tooltip: 'Sil',
                  icon: Icon(Icons.delete_outline, size: 20, color: t.danger),
                  onPressed: () async {
                    await widget.store.deleteCard(widget.card!);
                    if (context.mounted) Navigator.of(context).pop(true);
                  },
                ),
              IconButton(
                tooltip: 'Kapat',
                icon: Icon(Icons.close, size: 20, color: t.textMuted),
                onPressed: () => Navigator.of(context).pop(false),
              ),
            ],
          ),
        ),

        /* ---- gövde ---- */
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            children: [
              const _Label('Başlık'),
              TextField(
                controller: _title,
                autofocus: widget.card == null,
                decoration: const InputDecoration(hintText: 'Ne yapacaksın?'),
              ),
              const SizedBox(height: 16),

              const _Label('Gün'),
              OutlinedButton.icon(
                onPressed: _pickDay,
                icon: const Icon(Icons.calendar_today_outlined, size: 17),
                label: Align(
                  alignment: Alignment.centerLeft,
                  child: Text('${dayName(_day)} · ${shortDate(_day)}'),
                ),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(46),
                  alignment: Alignment.centerLeft,
                ),
              ),
              const SizedBox(height: 16),

              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _Label('Başlangıç'),
                        _TimeButton(
                          value: _format(_start),
                          onPick: () => _pickTime(start: true),
                          onClear: () => setState(() => _start = null),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const _Label('Bitiş'),
                        _TimeButton(
                          value: _format(_end),
                          onPick: () => _pickTime(start: false),
                          onClear: () => setState(() => _end = null),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              const _Label('Renk'),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final key in cardColorKeys)
                    GestureDetector(
                      onTap: () => setState(() => _color = key),
                      child: Container(
                        width: 34,
                        height: 34,
                        decoration: BoxDecoration(
                          color: Color.alphaBlend(
                            t.cardColor(key).withValues(alpha: .62),
                            t.surface,
                          ),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: _color == key
                                ? t.cardColor(key)
                                : t.cardColor(key).withValues(alpha: .6),
                            width: _color == key ? 3 : 1,
                          ),
                        ),
                        child: _color == key
                            ? Icon(Icons.check, size: 16, color: t.surface)
                            : null,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 16),

              const _Label('Öncelik'),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  for (final priority in cardPriorityKeys)
                    _PriorityChip(
                      priority: priority,
                      selected: _priority == priority,
                      onTap: () => setState(() => _priority = priority),
                    ),
                ],
              ),
              const SizedBox(height: 16),

              const _Label('Son tarih'),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _pickDeadline,
                      icon: const Icon(Icons.flag_outlined, size: 17),
                      label: Align(
                        alignment: Alignment.centerLeft,
                        child: Text(
                          _deadline == null
                              ? 'Son tarih seç'
                              : deadlineLabel(
                                  _deadline!.toUtc().toIso8601String(),
                                ),
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(46),
                        alignment: Alignment.centerLeft,
                      ),
                    ),
                  ),
                  if (_deadline != null) ...[
                    const SizedBox(width: 4),
                    IconButton(
                      tooltip: 'Son tarihi temizle',
                      onPressed: () => setState(() => _deadline = null),
                      icon: Icon(Icons.close, size: 18, color: t.textFaint),
                    ),
                  ],
                ],
              ),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'Tarih geçtiğinde tamamlanmamış kart gecikmiş olarak işaretlenir.',
                  style: TextStyle(fontSize: 11.5, color: t.textFaint),
                ),
              ),
              const SizedBox(height: 16),

              const _Label('Not'),
              TextField(
                controller: _note,
                minLines: 3,
                maxLines: 6,
                decoration: const InputDecoration(
                  hintText: 'Detaylar, sayılar…',
                ),
              ),
              const SizedBox(height: 16),

              Row(
                children: [
                  const Expanded(child: _Label('Checklist')),
                  Text(
                    '${_checklist.length}/50',
                    style: TextStyle(fontSize: 11.5, color: t.textFaint),
                  ),
                ],
              ),
              for (final item in _checklist)
                Padding(
                  padding: const EdgeInsets.only(bottom: 7),
                  child: Row(
                    children: [
                      Checkbox(
                        value: item.done,
                        onChanged: (value) => setState(() {
                          final index = _checklist.indexWhere(
                            (entry) => entry.id == item.id,
                          );
                          if (index >= 0) {
                            _checklist[index] = item.copyWith(
                              done: value ?? false,
                            );
                          }
                        }),
                      ),
                      Expanded(
                        child: TextFormField(
                          key: ValueKey(item.id),
                          initialValue: item.text,
                          maxLength: 500,
                          buildCounter:
                              (_, {
                                required currentLength,
                                required isFocused,
                                maxLength,
                              }) => null,
                          decoration: const InputDecoration(
                            hintText: 'Yeni madde',
                            isDense: true,
                          ),
                          onChanged: (value) {
                            final index = _checklist.indexWhere(
                              (entry) => entry.id == item.id,
                            );
                            if (index >= 0) {
                              _checklist[index] = item.copyWith(text: value);
                            }
                          },
                        ),
                      ),
                      IconButton(
                        tooltip: 'Maddeyi kaldır',
                        icon: Icon(Icons.close, size: 18, color: t.textFaint),
                        onPressed: () => setState(
                          () => _checklist.removeWhere(
                            (entry) => entry.id == item.id,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed: _checklist.length >= 50
                      ? null
                      : () => setState(
                          () => _checklist.add(
                            ChecklistItem(
                              id: newUuid(),
                              text: '',
                              done: false,
                            ),
                          ),
                        ),
                  icon: const Icon(Icons.add, size: 17),
                  label: const Text('Madde ekle'),
                ),
              ),
              const SizedBox(height: 16),

              const _Label('Hatırlat'),
              Wrap(
                spacing: 7,
                runSpacing: 7,
                children: [
                  _Chip(
                    label: allOn ? 'Hiçbiri' : 'Hepsi',
                    on: allOn,
                    onTap: () => setState(() {
                      _reminders
                        ..clear()
                        ..addAll(allOn ? const <int>[] : allReminders);
                    }),
                  ),
                  for (final option in reminderOptions)
                    _Chip(
                      label: option.label,
                      on: _reminders.contains(option.minutes),
                      onTap: () => setState(() {
                        if (_reminders.contains(option.minutes)) {
                          _reminders.remove(option.minutes);
                        } else {
                          _reminders.add(option.minutes);
                        }
                      }),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                'Başlangıç saatine bu kadar kala uyarır. Saat girilmezse 09:00 baz alınır.',
                style: TextStyle(fontSize: 11.5, color: t.textFaint),
              ),
              const SizedBox(height: 16),

              const _Label('Görseller'),
              if (_images.isNotEmpty || _pending.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final image in _images)
                        _Thumb(
                          image: Image.network(
                            widget.store.api.imageUrl(image.thumbUrl),
                            headers: widget.store.api.imageHeaders,
                            fit: BoxFit.cover,
                          ),
                          onRemove: () => _removeExisting(image),
                        ),
                      for (var i = 0; i < _pending.length; i++)
                        _Thumb(
                          image: Image.memory(
                            _pending[i].bytes,
                            fit: BoxFit.cover,
                          ),
                          onRemove: () => setState(() => _pending.removeAt(i)),
                        ),
                    ],
                  ),
                ),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () => _pickImages(source: ImageSource.gallery),
                      icon: const Icon(Icons.photo_library_outlined, size: 18),
                      label: const Text('Galeriden seç'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(46),
                      ),
                    ),
                  ),
                  if (_cameraAvailable) ...[
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () =>
                            _pickImages(source: ImageSource.camera),
                        icon: const Icon(Icons.photo_camera_outlined, size: 18),
                        label: const Text('Kamera'),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(46),
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              if (_pending.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    '${_pending.length} görsel kaydederken yüklenecek.',
                    style: TextStyle(fontSize: 11.5, color: t.textFaint),
                  ),
                ),

              if (widget.card?.manualSort == true) ...[
                const SizedBox(height: 6),
                CheckboxListTile(
                  value: _resetOrder,
                  onChanged: (v) => setState(() => _resetOrder = v ?? false),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  title: Text(
                    'Bu kart elle taşınmıştı — tekrar saate göre sıralansın',
                    style: TextStyle(fontSize: 12.5, color: t.textMuted),
                  ),
                ),
              ],
            ],
          ),
        ),

        /* ---- alt çubuk ---- */
        Container(
          padding: const EdgeInsets.fromLTRB(18, 12, 18, 12),
          decoration: BoxDecoration(
            color: t.surface2,
            border: Border(top: BorderSide(color: t.border)),
          ),
          child: SafeArea(
            top: false,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  child: const Text('Vazgeç'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _saving ? null : _save,
                  child: Text(_saving ? 'Kaydediliyor…' : 'Kaydet'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _Label extends StatelessWidget {
  const _Label(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 11.5,
        fontWeight: FontWeight.w600,
        letterSpacing: .4,
        color: context.tokens.textFaint,
      ),
    ),
  );
}

/// Yüklenmiş ya da yüklenmeyi bekleyen görselin küçük önizlemesi.
class _Thumb extends StatelessWidget {
  const _Thumb({required this.image, required this.onRemove});
  final Widget image;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return SizedBox(
      width: 76,
      height: 76,
      child: Stack(
        children: [
          Positioned.fill(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(R.md),
              child: Container(color: t.surface2, child: image),
            ),
          ),
          Positioned(
            top: 2,
            right: 2,
            child: GestureDetector(
              onTap: onRemove,
              child: Container(
                width: 24,
                height: 24,
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: .55),
                  shape: BoxShape.circle,
                ),
                child: const Icon(Icons.close, size: 14, color: Colors.white),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TimeButton extends StatelessWidget {
  const _TimeButton({
    required this.value,
    required this.onPick,
    required this.onClear,
  });
  final String? value;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return OutlinedButton(
      onPressed: onPick,
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
      child: Row(
        children: [
          Text(
            value ?? '--:--',
            style: TextStyle(
              color: value == null ? t.textFaint : t.text,
              fontSize: 14,
            ),
          ),
          const Spacer(),
          if (value != null)
            GestureDetector(
              onTap: onClear,
              child: Icon(Icons.close, size: 16, color: t.textFaint),
            )
          else
            Icon(Icons.schedule, size: 17, color: t.textFaint),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.on, required this.onTap});
  final String label;
  final bool on;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        constraints: const BoxConstraints(minHeight: 40),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: on
              ? Color.alphaBlend(t.accent.withValues(alpha: .16), t.surface)
              : Colors.transparent,
          border: Border.all(color: on ? t.accent : t.borderStrong),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (on) ...[
              Icon(Icons.check, size: 13, color: t.accent),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: on ? FontWeight.w600 : FontWeight.w500,
                color: on ? t.accent : t.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PriorityChip extends StatelessWidget {
  const _PriorityChip({
    required this.priority,
    required this.selected,
    required this.onTap,
  });

  final String priority;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final color = switch (priority) {
      'low' => t.cardColor('blue'),
      'medium' => t.cardColor('amber'),
      'high' => t.cardColor('orange'),
      'urgent' => t.cardColor('red'),
      _ => t.textFaint,
    };
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        constraints: const BoxConstraints(minHeight: 36),
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 7),
        decoration: BoxDecoration(
          color: selected
              ? Color.alphaBlend(color.withValues(alpha: .16), t.surface)
              : Colors.transparent,
          border: Border.all(color: selected ? color : t.borderStrong),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (selected) ...[
              Icon(Icons.check, size: 13, color: color),
              const SizedBox(width: 4),
            ],
            Text(
              cardPriorityLabel(priority),
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
                color: selected ? color : t.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
