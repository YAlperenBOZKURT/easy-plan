import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../planner_views.dart';
import '../store.dart';
import '../theme.dart';
import 'card_tile.dart';

class PlannerCollectionView extends StatelessWidget {
  const PlannerCollectionView({
    super.key,
    required this.view,
    required this.anchor,
    required this.days,
    required this.cards,
    required this.store,
    required this.onAdd,
    required this.onCard,
  }) : assert(view != PlannerViewMode.week);

  final PlannerViewMode view;
  final String anchor;
  final List<String> days;
  final List<PlannerCard> cards;
  final PlannerStore store;
  final void Function(String day) onAdd;
  final void Function(PlannerCard card) onCard;

  @override
  Widget build(BuildContext context) {
    if (view == PlannerViewMode.month) {
      return _MonthView(
        anchor: anchor,
        days: days,
        cards: cards,
        onAdd: onAdd,
        onCard: onCard,
      );
    }
    return _AgendaView(
      cards: cards,
      completed: view == PlannerViewMode.completed,
      store: store,
      onCard: onCard,
    );
  }
}

class _MonthView extends StatelessWidget {
  const _MonthView({
    required this.anchor,
    required this.days,
    required this.cards,
    required this.onAdd,
    required this.onCard,
  });

  final String anchor;
  final List<String> days;
  final List<PlannerCard> cards;
  final void Function(String day) onAdd;
  final void Function(PlannerCard card) onCard;

  @override
  Widget build(BuildContext context) {
    final byDay = <String, List<PlannerCard>>{
      for (final day in days) day: <PlannerCard>[],
    };
    for (final card in cards) {
      byDay[card.day]?.add(card);
    }
    for (final list in byDay.values) {
      list.sort((a, b) => a.sortIndex.compareTo(b.sortIndex));
    }
    final month = anchor.substring(0, 7);

    return LayoutBuilder(
      builder: (context, constraints) {
        final compact = constraints.maxWidth < 768;
        final compactColumns = constraints.maxWidth >= 450 ? 3 : 2;
        final visibleDays = compact
            ? days.where((day) => day.startsWith(month)).toList()
            : days;
        return SizedBox(
          width: constraints.maxWidth,
          height: constraints.maxHeight,
          child: Column(
            children: [
              if (!compact) const _WeekdayHeader(),
              Expanded(
                child: GridView.builder(
                  padding: EdgeInsets.fromLTRB(
                    compact ? 4 : 10,
                    0,
                    compact ? 4 : 10,
                    12,
                  ),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: compact ? compactColumns : 7,
                    mainAxisExtent: compact ? 142 : null,
                    childAspectRatio: .88,
                  ),
                  itemCount: visibleDays.length,
                  itemBuilder: (context, index) {
                    final day = visibleDays[index];
                    return _MonthDay(
                      day: day,
                      cards: byDay[day] ?? const [],
                      outside: !day.startsWith(month),
                      compact: compact,
                      onAdd: () => onAdd(day),
                      onCard: onCard,
                    );
                  },
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _WeekdayHeader extends StatelessWidget {
  const _WeekdayHeader();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
    child: Row(
      children: [
        for (final day in ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'])
          Expanded(
            child: Text(
              day,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
      ],
    ),
  );
}

class _MonthDay extends StatelessWidget {
  const _MonthDay({
    required this.day,
    required this.cards,
    required this.outside,
    required this.compact,
    required this.onAdd,
    required this.onCard,
  });

  final String day;
  final List<PlannerCard> cards;
  final bool outside;
  final bool compact;
  final VoidCallback onAdd;
  final void Function(PlannerCard card) onCard;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final today = day == todayKey();
    return Opacity(
      opacity: outside ? .52 : 1,
      child: Container(
        margin: const EdgeInsets.all(1),
        padding: EdgeInsets.all(compact ? 7 : 6),
        decoration: BoxDecoration(
          color: today
              ? Color.alphaBlend(t.accent.withValues(alpha: .05), t.surface)
              : t.surface,
          border: Border.all(
            color: today ? t.accent.withValues(alpha: .5) : t.border,
          ),
          borderRadius: BorderRadius.circular(R.sm),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (compact) ...[
                      Text(
                        dayNameShort(day),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w600,
                          color: t.textFaint,
                        ),
                      ),
                      const SizedBox(width: 5),
                    ],
                    Container(
                      width: 24,
                      height: 24,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: today ? t.accent : Colors.transparent,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${dayNumber(day)}',
                        style: TextStyle(
                          fontSize: compact ? 11 : 11.5,
                          fontWeight: FontWeight.w600,
                          color: today ? t.accentFg : t.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                _MonthAddButton(
                  compact: compact,
                  label: '${shortDate(day)} için kart ekle',
                  onTap: onAdd,
                ),
              ],
            ),
            SizedBox(height: compact ? 5 : 3),
            for (final card in cards.take(3))
              _MonthCard(
                card: card,
                compact: compact,
                onTap: () => onCard(card),
              ),
            if (cards.length > 3)
              Padding(
                padding: EdgeInsets.fromLTRB(compact ? 1 : 5, 2, 2, 0),
                child: Text(
                  '+${cards.length - 3}',
                  style: TextStyle(
                    fontSize: compact ? 8.5 : 10,
                    color: t.textFaint,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MonthAddButton extends StatelessWidget {
  const _MonthAddButton({
    required this.compact,
    required this.label,
    required this.onTap,
  });

  final bool compact;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    if (!compact) {
      return IconButton(
        onPressed: onTap,
        icon: const Icon(Icons.add, size: 16),
        tooltip: label,
        visualDensity: VisualDensity.compact,
        padding: EdgeInsets.zero,
        constraints: const BoxConstraints.tightFor(width: 28, height: 28),
      );
    }
    return Semantics(
      button: true,
      label: label,
      child: Tooltip(
        message: label,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: const SizedBox(
            width: 26,
            height: 26,
            child: Icon(Icons.add, size: 16),
          ),
        ),
      ),
    );
  }
}

class _MonthCard extends StatelessWidget {
  const _MonthCard({
    required this.card,
    required this.onTap,
    this.compact = false,
  });

  final PlannerCard card;
  final VoidCallback onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final color = t.cardColor(card.color);
    return Padding(
      padding: EdgeInsets.only(bottom: compact ? 2 : 3),
      child: Material(
        color: Color.alphaBlend(color.withValues(alpha: .08), t.surface2),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: EdgeInsets.symmetric(
              horizontal: compact ? 6 : 5,
              vertical: 5,
            ),
            decoration: BoxDecoration(
              border: Border(left: BorderSide(color: color, width: 3)),
            ),
            child: Row(
              children: [
                if (!compact && card.startTime != null) ...[
                  Text(
                    card.startTime!,
                    style: TextStyle(fontSize: 9.5, color: t.textFaint),
                  ),
                  const SizedBox(width: 4),
                ],
                Expanded(
                  child: Text(
                    card.title.isEmpty ? 'Başlıksız kart' : card.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10.5,
                      color: t.text,
                      decoration: card.done ? TextDecoration.lineThrough : null,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _AgendaView extends StatelessWidget {
  const _AgendaView({
    required this.cards,
    required this.completed,
    required this.store,
    required this.onCard,
  });

  final List<PlannerCard> cards;
  final bool completed;
  final PlannerStore store;
  final void Function(PlannerCard card) onCard;

  @override
  Widget build(BuildContext context) {
    final visible = cards.where((card) => !completed || card.done).toList();
    final groups = <String, List<PlannerCard>>{};
    for (final card in visible) {
      (groups[card.day] ??= []).add(card);
    }

    if (visible.isEmpty) {
      return _EmptyCollection(completed: completed);
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 28),
      children: [
        for (final entry in groups.entries) ...[
          _AgendaHeader(day: entry.key),
          for (final card in entry.value)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  IconButton(
                    onPressed: () => store.toggleDone(card),
                    icon: Icon(
                      card.done
                          ? Icons.check_circle
                          : Icons.radio_button_unchecked,
                    ),
                    tooltip: card.done ? 'Geri al' : 'Tamamla',
                  ),
                  Expanded(
                    child: CardTile(
                      card: card,
                      imageHeaders: store.api.imageHeaders,
                      imageUrl: store.api.imageUrl,
                      onTap: () => onCard(card),
                      onToggleChecklist: (itemId) =>
                          store.toggleChecklistItem(card, itemId),
                    ),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _AgendaHeader extends StatelessWidget {
  const _AgendaHeader({required this.day});
  final String day;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 6, 4, 8),
      child: Row(
        children: [
          Text(
            dayName(day),
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: t.text),
          ),
          const SizedBox(width: 8),
          Text(shortDate(day), style: TextStyle(fontSize: 12, color: t.textFaint)),
          const Spacer(),
          if (day == todayKey())
            Text('Bugün', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: t.accent)),
        ],
      ),
    );
  }
}

class _EmptyCollection extends StatelessWidget {
  const _EmptyCollection({required this.completed});
  final bool completed;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(30),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              completed ? Icons.task_alt : Icons.view_agenda_outlined,
              size: 42,
              color: t.accent,
            ),
            const SizedBox(height: 12),
            Text(
              completed ? 'Bu ay tamamlanan kart yok' : 'Bu ay ajanda boş',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: t.text),
            ),
            const SizedBox(height: 4),
            Text(
              completed
                  ? 'Tamamladığın kartlar burada tarih sırasıyla görünür.'
                  : 'Kart eklediğinde burada tarih sırasıyla görünür.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: t.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
