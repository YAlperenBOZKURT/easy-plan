import 'package:flutter/material.dart';

import '../api/models.dart';
import '../deadline.dart';
import '../theme.dart';

/// Takvim kartı — web'deki .card ile aynı görsel dil:
/// çepeçevre renkli kenarlık, ortalanmış saat rozeti, yapıldıda çapraz tarama.
class CardTile extends StatelessWidget {
  const CardTile({
    super.key,
    required this.card,
    required this.imageHeaders,
    required this.imageUrl,
    this.onTap,
    this.onLongPress,
    this.onToggleChecklist,
  });

  final PlannerCard card;
  final Map<String, String> imageHeaders;
  final String Function(String path) imageUrl;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final void Function(String itemId)? onToggleChecklist;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final c = t.cardColor(card.color);
    final faded = card.done ? .45 : 1.0;
    final dueState = deadlineState(card.deadlineAt, card.done);

    final semanticLabel = [
      card.title.isEmpty ? 'Başlıksız kart' : card.title,
      if (card.hasTime) card.timeLabel,
      if (card.done) 'Yapıldı',
    ].join(', ');

    return Semantics(
      button: true,
      label: semanticLabel,
      hint: 'Kart işlemlerini aç',
      excludeSemantics: true,
      child: Material(
        color: Color.alphaBlend(
          c.withValues(alpha: card.done ? .06 : .07),
          t.surface,
        ),
        borderRadius: BorderRadius.circular(R.md),
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          borderRadius: BorderRadius.circular(R.md),
          child: CustomPaint(
            painter: card.done ? _HatchPainter(c.withValues(alpha: .16)) : null,
            child: Container(
              decoration: BoxDecoration(
                border: Border.all(
                  color: c.withValues(alpha: card.done ? .35 : .5),
                ),
                borderRadius: BorderRadius.circular(R.md),
              ),
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (card.hasTime ||
                      card.priority != 'none' ||
                      (card.deadlineAt != null &&
                          dueState != DeadlineState.completed))
                    Center(
                      child: Opacity(
                        opacity: faded,
                        child: Wrap(
                          alignment: WrapAlignment.center,
                          spacing: 5,
                          runSpacing: 4,
                          children: [
                            if (card.hasTime)
                              _Badge(
                                label: card.timeLabel,
                                color: c,
                                tabular: true,
                              ),
                            if (card.priority != 'none')
                              _Badge(
                                label: cardPriorityLabel(card.priority),
                                color: _priorityColor(t, card.priority),
                              ),
                            if (card.deadlineAt != null &&
                                dueState != DeadlineState.completed)
                              _Badge(
                                label: deadlineBadgeLabel(
                                  card.deadlineAt!,
                                  dueState,
                                ),
                                color: _deadlineColor(t, dueState),
                              ),
                          ],
                        ),
                      ),
                    ),
                  if (card.hasTime ||
                      card.priority != 'none' ||
                      (card.deadlineAt != null &&
                          dueState != DeadlineState.completed))
                    const SizedBox(height: 7),
                  if (card.title.isNotEmpty)
                    Opacity(
                      opacity: faded,
                      child: Text(
                        card.title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13.5,
                          fontWeight: FontWeight.w600,
                          height: 1.3,
                          letterSpacing: -.13,
                          color: t.text,
                          decoration: card.done
                              ? TextDecoration.lineThrough
                              : null,
                          decorationColor: c,
                        ),
                      ),
                    ),
                  if (card.note.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Opacity(
                      opacity: faded,
                      child: Text(
                        card.note,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          color: t.textMuted,
                        ),
                      ),
                    ),
                  ],
                  if (card.checklist.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    _Checklist(
                      card: card,
                      color: c,
                      onToggle: onToggleChecklist,
                    ),
                  ],
                  if (card.images.isNotEmpty) ...[
                    const SizedBox(height: 7),
                    Opacity(
                      opacity: faded,
                      child: _Images(
                        card: card,
                        url: imageUrl,
                        headers: imageHeaders,
                      ),
                    ),
                  ],
                  if (card.reminders.isNotEmpty || card.habitId != null) ...[
                    const SizedBox(height: 7),
                    Row(
                      children: [
                        if (card.reminders.isNotEmpty) ...[
                          Icon(
                            Icons.notifications_none,
                            size: 13,
                            color: t.textFaint,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            '${card.reminders.length}',
                            style: TextStyle(fontSize: 11, color: t.textFaint),
                          ),
                        ],
                        if (card.habitId != null) ...[
                          const SizedBox(width: 10),
                          Icon(Icons.repeat, size: 13, color: t.textFaint),
                        ],
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

Color _priorityColor(PlannerTokens tokens, String priority) => switch (priority) {
  'low' => tokens.cardColor('blue'),
  'medium' => tokens.cardColor('amber'),
  'high' => tokens.cardColor('orange'),
  'urgent' => tokens.cardColor('red'),
  _ => tokens.textFaint,
};

Color _deadlineColor(PlannerTokens tokens, DeadlineState state) => switch (state) {
  DeadlineState.overdue => tokens.cardColor('red'),
  DeadlineState.soon => tokens.cardColor('amber'),
  _ => tokens.cardColor('violet'),
};

class _Badge extends StatelessWidget {
  const _Badge({required this.label, required this.color, this.tabular = false});

  final String label;
  final Color color;
  final bool tabular;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
      decoration: BoxDecoration(
        color: Color.alphaBlend(color.withValues(alpha: .16), t.surface),
        border: Border.all(color: color.withValues(alpha: .4)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          color: Color.alphaBlend(color.withValues(alpha: .8), t.text),
          fontFeatures: tabular ? const [FontFeature.tabularFigures()] : null,
        ),
      ),
    );
  }
}

class _Checklist extends StatelessWidget {
  const _Checklist({
    required this.card,
    required this.color,
    this.onToggle,
  });

  final PlannerCard card;
  final Color color;
  final void Function(String itemId)? onToggle;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final completed = card.checklist.where((item) => item.done).length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              '$completed/${card.checklist.length}',
              style: TextStyle(fontSize: 10.5, color: t.textFaint),
            ),
            const SizedBox(width: 7),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  minHeight: 3,
                  value: completed / card.checklist.length,
                  backgroundColor: t.border,
                  valueColor: AlwaysStoppedAnimation(color),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        for (final item in card.checklist.take(3))
          Semantics(
            button: onToggle != null,
            checked: item.done,
            label: item.text,
            child: InkWell(
              onTap: onToggle == null ? null : () => onToggle!(item.id),
              borderRadius: BorderRadius.circular(R.sm),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    Container(
                      width: 16,
                      height: 16,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: item.done ? color : Colors.transparent,
                        border: Border.all(
                          color: item.done
                              ? color
                              : color.withValues(alpha: .55),
                        ),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: item.done
                          ? Icon(Icons.check, size: 11, color: t.surface)
                          : null,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        item.text,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: item.done ? t.textFaint : t.textMuted,
                          decoration: item.done
                              ? TextDecoration.lineThrough
                              : null,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        if (card.checklist.length > 3)
          Padding(
            padding: const EdgeInsets.only(left: 20),
            child: Text(
              '+${card.checklist.length - 3} madde',
              style: TextStyle(fontSize: 10.5, color: t.textFaint),
            ),
          ),
      ],
    );
  }
}

class _Images extends StatelessWidget {
  const _Images({required this.card, required this.url, required this.headers});
  final PlannerCard card;
  final String Function(String) url;
  final Map<String, String> headers;

  @override
  Widget build(BuildContext context) {
    final single = card.images.length == 1;
    final shown = card.images.take(3).toList();
    return SizedBox(
      height: single ? 88 : 48,
      child: Row(
        children: [
          for (var i = 0; i < shown.length; i++) ...[
            if (i > 0) const SizedBox(width: 4),
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(R.sm),
                child: Image.network(
                  url(shown[i].thumbUrl),
                  headers: headers,
                  fit: BoxFit.cover,
                  height: single ? 88 : 48,
                  errorBuilder: (_, _, _) => ColoredBox(
                    color: context.tokens.surface2,
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// "Yapıldı" kartındaki çapraz tarama deseni.
class _HatchPainter extends CustomPainter {
  _HatchPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 6;
    const step = 13.0;
    canvas.save();
    canvas.clipRRect(
      RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(R.md)),
    );
    for (double x = -size.height; x < size.width + size.height; x += step) {
      canvas.drawLine(
        Offset(x, size.height),
        Offset(x + size.height, 0),
        paint,
      );
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_HatchPainter old) => old.color != color;
}
