import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../store.dart';
import '../theme.dart';

/// Kartı rahatça incelemek için okuma penceresi (web'deki "İncele" ile aynı).
/// Metin kırpılmaz, görseller büyük; görsele dokununca tam ekran açılır.
Future<String?> showCardView(
  BuildContext context, {
  required PlannerStore store,
  required PlannerCard card,
}) {
  final wide = MediaQuery.sizeOf(context).width >= 640;
  final view = CardView(store: store, card: card);

  if (wide) {
    return showDialog<String>(
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
            maxWidth: 560,
            maxHeight: MediaQuery.sizeOf(context).height * .86,
          ),
          child: view,
        ),
      ),
    );
  }

  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
    ),
    builder: (_) => FractionallySizedBox(heightFactor: .92, child: view),
  );
}

class CardView extends StatelessWidget {
  const CardView({super.key, required this.store, required this.card});

  final PlannerStore store;
  final PlannerCard card;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final c = t.cardColor(card.color);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(18, 14, 10, 14),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: t.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Row(
                  children: [
                    Text(
                      'İncele',
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: t.text,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Flexible(
                      child: Text(
                        '${dayName(card.day)} · ${shortDate(card.day)}',
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 12.5, color: t.textFaint),
                      ),
                    ),
                  ],
                ),
              ),
              // Kapat düğmesi: sabit ölçü, kenara yapışmasın
              SizedBox(
                width: 36,
                height: 36,
                child: IconButton(
                  tooltip: 'Kapat',
                  padding: EdgeInsets.zero,
                  iconSize: 19,
                  icon: Icon(Icons.close, color: t.textMuted),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ),
            ],
          ),
        ),

        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
            children: [
              if (card.hasTime)
                Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 11,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: Color.alphaBlend(
                        c.withValues(alpha: .2),
                        t.surface,
                      ),
                      border: Border.all(color: c.withValues(alpha: .32)),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      card.timeLabel,
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: Color.alphaBlend(
                          c.withValues(alpha: .78),
                          t.text,
                        ),
                      ),
                    ),
                  ),
                ),
              if (card.hasTime) const SizedBox(height: 14),

              Text(
                card.title.isEmpty ? '(başlıksız)' : card.title,
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -.35,
                  height: 1.25,
                  color: card.done ? t.textMuted : t.text,
                  decoration: card.done ? TextDecoration.lineThrough : null,
                ),
              ),

              if (card.note.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  card.note,
                  style: TextStyle(fontSize: 14, height: 1.6, color: t.text),
                ),
              ],

              if (card.checklist.isNotEmpty) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: t.surface2,
                    border: Border.all(color: t.border),
                    borderRadius: BorderRadius.circular(R.md),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'CHECKLIST',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              letterSpacing: .35,
                              color: t.textFaint,
                            ),
                          ),
                          const Spacer(),
                          Text(
                            '${card.checklist.where((item) => item.done).length}/${card.checklist.length}',
                            style: TextStyle(fontSize: 12, color: t.textFaint),
                          ),
                        ],
                      ),
                      const SizedBox(height: 9),
                      for (final item in card.checklist)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 7),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                width: 17,
                                height: 17,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: item.done ? c : Colors.transparent,
                                  border: Border.all(
                                    color: item.done ? c : t.borderStrong,
                                  ),
                                  borderRadius: BorderRadius.circular(5),
                                ),
                                child: item.done
                                    ? Icon(Icons.check, size: 11, color: t.surface)
                                    : null,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  item.text,
                                  style: TextStyle(
                                    fontSize: 13,
                                    height: 1.4,
                                    color: item.done ? t.textFaint : t.text,
                                    decoration: item.done
                                        ? TextDecoration.lineThrough
                                        : null,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],

              if (card.images.isNotEmpty) ...[
                const SizedBox(height: 14),
                for (final image in card.images)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: GestureDetector(
                      onTap: () =>
                          _zoom(context, store.api.imageUrl(image.url)),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(R.md),
                        child: Image.network(
                          store.api.imageUrl(image.url),
                          headers: store.api.imageHeaders,
                          fit: BoxFit.contain,
                          errorBuilder: (_, _, _) => Container(
                            height: 120,
                            color: t.surface2,
                            alignment: Alignment.center,
                            child: Text(
                              'Görsel yüklenemedi',
                              style: TextStyle(
                                fontSize: 12,
                                color: t.textFaint,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],

              const SizedBox(height: 14),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: t.surface2,
                  border: Border.all(color: t.border),
                  borderRadius: BorderRadius.circular(R.md),
                ),
                child: Wrap(
                  spacing: 24,
                  runSpacing: 12,
                  children: [
                    _Meta(
                      label: 'Durum',
                      value: card.done ? 'Yapıldı' : 'Bekliyor',
                    ),
                    _Meta(
                      label: 'Hatırlatma',
                      value: card.reminders.isEmpty
                          ? 'Yok'
                          : card.reminders
                                .map(
                                  (m) => reminderOptions
                                      .firstWhere(
                                        (o) => o.minutes == m,
                                        orElse: () =>
                                            (minutes: m, label: '$m dk'),
                                      )
                                      .label,
                                )
                                .join(' · '),
                    ),
                    if (card.habitId != null)
                      const _Meta(
                        label: 'Kaynak',
                        value: 'Davranıştan üretildi',
                      ),
                    _Meta(label: 'Görsel', value: '${card.images.length}'),
                  ],
                ),
              ),
            ],
          ),
        ),

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
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Kapat'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: () => Navigator.of(context).pop('edit'),
                  child: const Text('Düzenle'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  void _zoom(BuildContext context, String url) {
    showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .9),
      builder: (dialogContext) => GestureDetector(
        onTap: () => Navigator.of(dialogContext).pop(),
        child: InteractiveViewer(
          child: Center(
            child: Image.network(
              url,
              headers: store.api.imageHeaders,
              fit: BoxFit.contain,
            ),
          ),
        ),
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          label.toUpperCase(),
          style: TextStyle(
            fontSize: 10.5,
            fontWeight: FontWeight.w600,
            letterSpacing: .4,
            color: t.textFaint,
          ),
        ),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontSize: 13, color: t.text)),
      ],
    );
  }
}
