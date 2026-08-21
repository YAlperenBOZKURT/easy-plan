import 'package:flutter/material.dart';

import '../filters.dart';
import '../tags.dart';
import '../theme.dart';

Future<CardFilterState?> showCardFilterSheet(
  BuildContext context, {
  required CardFilterState currentFilters,
  required List<String> allTags,
  required Future<List<String>> Function() loadTags,
}) {
  final view = _FilterSheet(
    currentFilters: currentFilters,
    allTags: allTags,
    loadTags: loadTags,
  );
  final isWide = MediaQuery.sizeOf(context).width >= 640;

  if (isWide) {
    return showDialog<CardFilterState>(
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
            maxWidth: 520,
            maxHeight: MediaQuery.sizeOf(context).height * .85,
          ),
          child: view,
        ),
      ),
    );
  }

  return showModalBottomSheet<CardFilterState>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
    ),
    builder: (_) => FractionallySizedBox(heightFactor: .85, child: view),
  );
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({
    required this.currentFilters,
    required this.allTags,
    required this.loadTags,
  });

  final CardFilterState currentFilters;
  final List<String> allTags;
  final Future<List<String>> Function() loadTags;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late CardFilterState _filters = widget.currentFilters;
  late List<String> _allTags = widget.allTags;

  @override
  void initState() {
    super.initState();
    _loadTags();
  }

  Future<void> _loadTags() async {
    try {
      final tags = await widget.loadTags();
      if (mounted) setState(() => _allTags = tags);
    } catch (_) {
      // Keep the immediately available tags if remote and cache loading fail.
    }
  }

  static const _priorities = [
    ('all', 'Tümü'),
    ('urgent', 'Acil'),
    ('high', 'Yüksek'),
    ('medium', 'Orta'),
    ('low', 'Düşük'),
    ('none', 'Yok'),
  ];

  static const _colors = [
    'all',
    'red',
    'orange',
    'amber',
    'green',
    'teal',
    'blue',
    'violet',
    'pink',
  ];

  void _toggleTag(String tag) {
    setState(() {
      final current = Set<String>.from(_filters.tags);
      final normalized = normalizeTag(tag);
      final existing = current.firstWhere(
        (t) => tagKey(t) == tagKey(normalized),
        orElse: () => '',
      );
      if (existing.isNotEmpty) {
        current.remove(existing);
      } else {
        current.add(tag);
      }
      _filters = _filters.copyWith(tags: current);
    });
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
          child: Row(
            children: [
              Text(
                'Kartları Filtrele',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: t.text,
                ),
              ),
              const Spacer(),
              IconButton(
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
                tooltip: 'Kapat',
              ),
            ],
          ),
        ),
        const Divider(height: 1),
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SectionTitle(title: 'Durum'),
                Wrap(
                  spacing: 8,
                  children: [
                    _ChoiceChip(
                      label: 'Tümü',
                      selected: _filters.status == FilterStatus.all,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          status: FilterStatus.all,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Tamamlanacak',
                      selected: _filters.status == FilterStatus.todo,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          status: FilterStatus.todo,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Tamamlanan',
                      selected: _filters.status == FilterStatus.done,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          status: FilterStatus.done,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SectionTitle(title: 'Öncelik'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (key, label) in _priorities)
                      _ChoiceChip(
                        label: label,
                        selected: _filters.priority == key,
                        onTap: () => setState(
                          () => _filters = _filters.copyWith(priority: key),
                        ),
                      ),
                  ],
                ),
                if (_allTags.isNotEmpty) ...[
                  const SizedBox(height: 18),
                  Row(
                    children: [
                      _SectionTitle(
                        title:
                            'Etiketler'
                            '${_filters.tags.isNotEmpty ? ' (${_filters.tags.length})' : ''}',
                      ),
                      const Spacer(),
                      if (_filters.tags.isNotEmpty)
                        TextButton(
                          onPressed: () => setState(
                            () => _filters = _filters.copyWith(tags: {}),
                          ),
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 6),
                          ),
                          child: const Text(
                            'Temizle',
                            style: TextStyle(fontSize: 12),
                          ),
                        ),
                    ],
                  ),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final tag in _allTags) ...[
                        () {
                          final selected = _filters.tags.any(
                            (t) => tagKey(t) == tagKey(tag),
                          );
                          final color = t.cardColor(
                            ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink'][tagColorIndex(tag)],
                          );
                          return InkWell(
                            onTap: () => _toggleTag(tag),
                            borderRadius: BorderRadius.circular(999),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 5,
                              ),
                              decoration: BoxDecoration(
                                color: selected
                                    ? color
                                    : color.withValues(alpha: .12),
                                border: Border.all(
                                  color: selected
                                      ? color
                                      : color.withValues(alpha: .38),
                                ),
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  if (selected) ...[
                                    const Icon(
                                      Icons.check,
                                      size: 13,
                                      color: Colors.white,
                                    ),
                                    const SizedBox(width: 4),
                                  ],
                                  Text(
                                    tag,
                                    style: TextStyle(
                                      fontSize: 12,
                                      fontWeight: selected
                                          ? FontWeight.w600
                                          : FontWeight.w500,
                                      color: selected ? Colors.white : t.text,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        }(),
                      ],
                    ],
                  ),
                ],
                const SizedBox(height: 18),
                _SectionTitle(title: 'Kaynak'),
                Wrap(
                  spacing: 8,
                  children: [
                    _ChoiceChip(
                      label: 'Tümü',
                      selected: _filters.habit == FilterHabit.all,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          habit: FilterHabit.all,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Alışkanlıklar',
                      selected: _filters.habit == FilterHabit.habit,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          habit: FilterHabit.habit,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Elle Eklenenler',
                      selected: _filters.habit == FilterHabit.manual,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          habit: FilterHabit.manual,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SectionTitle(title: 'Son Tarih & Gecikme'),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _ChoiceChip(
                      label: 'Tümü',
                      selected: _filters.deadline == FilterDeadline.all,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          deadline: FilterDeadline.all,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Gecikenler',
                      selected: _filters.deadline == FilterDeadline.overdue,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          deadline: FilterDeadline.overdue,
                        ),
                      ),
                    ),
                    _ChoiceChip(
                      label: 'Son Tarihi Olanlar',
                      selected: _filters.deadline == FilterDeadline.hasDeadline,
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(
                          deadline: FilterDeadline.hasDeadline,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 18),
                _SectionTitle(title: 'Renk'),
                Wrap(
                  spacing: 8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    _ChoiceChip(
                      label: 'Tümü',
                      selected: _filters.color == 'all',
                      onTap: () => setState(
                        () => _filters = _filters.copyWith(color: 'all'),
                      ),
                    ),
                    for (final c in _colors.skip(1)) ...[
                      GestureDetector(
                        onTap: () => setState(
                          () => _filters = _filters.copyWith(color: c),
                        ),
                        child: Container(
                          width: 26,
                          height: 26,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: t.cardColor(c),
                            border: Border.all(
                              color: _filters.color == c
                                  ? t.text
                                  : Colors.transparent,
                              width: 2.5,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            children: [
              TextButton(
                onPressed: () =>
                    setState(() => _filters = CardFilterState.defaultFilters),
                child: const Text('Filtreleri Sıfırla'),
              ),
              const Spacer(),
              OutlinedButton(
                onPressed: () => Navigator.pop(context),
                child: const Text('İptal'),
              ),
              const SizedBox(width: 8),
              FilledButton(
                onPressed: () => Navigator.pop(context, _filters),
                child: const Text('Uygula'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: FontWeight.w600,
          color: t.textMuted,
        ),
      ),
    );
  }
}

class _ChoiceChip extends StatelessWidget {
  const _ChoiceChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      onSelected: (_) => onTap(),
      selectedColor: t.accent,
      backgroundColor: t.surface2,
      labelStyle: TextStyle(
        fontSize: 12.5,
        fontWeight: selected ? FontWeight.w600 : FontWeight.w500,
        color: selected ? t.accentFg : t.textMuted,
      ),
      side: BorderSide(
        color: selected ? t.accent : t.border,
      ),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    );
  }
}
