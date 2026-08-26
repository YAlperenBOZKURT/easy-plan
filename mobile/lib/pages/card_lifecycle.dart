import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../store.dart';
import '../theme.dart';

Future<void> showCardLifecycle(
  BuildContext context, {
  required PlannerStore store,
}) {
  final content = _CardLifecycle(store: store);
  if (MediaQuery.sizeOf(context).width >= 640) {
    return showDialog<void>(
      context: context,
      builder: (_) => Dialog(
        backgroundColor: context.tokens.surface,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 680, maxHeight: 720),
          child: content,
        ),
      ),
    );
  }
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
    ),
    builder: (_) => FractionallySizedBox(heightFactor: .9, child: content),
  );
}

class _CardLifecycle extends StatefulWidget {
  const _CardLifecycle({required this.store});
  final PlannerStore store;

  @override
  State<_CardLifecycle> createState() => _CardLifecycleState();
}

class _CardLifecycleState extends State<_CardLifecycle> {
  bool _trash = false;
  bool _loading = true;
  bool _busy = false;
  String? _error;
  List<PlannerCard> _cards = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cards = _trash
          ? await widget.store.api.trashedCards()
          : await widget.store.api.archivedCards();
      if (mounted) setState(() => _cards = cards);
    } catch (_) {
      if (mounted) setState(() => _error = 'Kartlar alınamadı.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'İşlem tamamlanamadı.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirmPermanent(PlannerCard card) async =>
      await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Kalıcı olarak sil?'),
          content: Text(
            '“${card.title.isEmpty ? 'Başlıksız kart' : card.title}” geri alınamayacak şekilde silinecek.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Vazgeç'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('Kalıcı sil'),
            ),
          ],
        ),
      ) ??
      false;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(18, 14, 10, 14),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: t.border)),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  'Arşiv ve Çöp Kutusu',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: t.text,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'Kapat',
                onPressed: () => Navigator.pop(context),
                icon: const Icon(Icons.close),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(
                value: false,
                label: Text('Arşiv'),
                icon: Icon(Icons.archive_outlined),
              ),
              ButtonSegment(
                value: true,
                label: Text('Çöp Kutusu'),
                icon: Icon(Icons.delete_outline),
              ),
            ],
            selected: {_trash},
            onSelectionChanged: (value) {
              setState(() => _trash = value.first);
              _load();
            },
          ),
        ),
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Text(_error!, style: TextStyle(color: t.danger)),
                )
              : _cards.isEmpty
              ? _Empty(trash: _trash)
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(14, 4, 14, 18),
                  itemCount: _cards.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (_, index) => _LifecycleCard(
                    card: _cards[index],
                    trash: _trash,
                    busy: _busy,
                    onRestore: () =>
                        _run(() => widget.store.restoreCard(_cards[index])),
                    onRemove: () async {
                      final card = _cards[index];
                      if (_trash) {
                        if (await _confirmPermanent(card)) {
                          await _run(
                            () => widget.store.permanentlyDeleteCard(card),
                          );
                        }
                      } else {
                        await _run(() => widget.store.deleteCard(card));
                      }
                    },
                  ),
                ),
        ),
      ],
    );
  }
}

class _LifecycleCard extends StatelessWidget {
  const _LifecycleCard({
    required this.card,
    required this.trash,
    required this.busy,
    required this.onRestore,
    required this.onRemove,
  });
  final PlannerCard card;
  final bool trash;
  final bool busy;
  final VoidCallback onRestore;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final color = t.cardColor(card.color);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: t.surface,
        border: Border.all(color: t.border),
        borderRadius: BorderRadius.circular(R.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 4,
            height: 48,
            decoration: BoxDecoration(
              color: color,
              borderRadius: BorderRadius.circular(99),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${dayName(card.day)} · ${shortDate(card.day)}',
                  style: TextStyle(fontSize: 11, color: t.textFaint),
                ),
                const SizedBox(height: 3),
                Text(
                  card.title.isEmpty ? '(başlıksız)' : card.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: t.text,
                  ),
                ),
                if (card.note.isNotEmpty)
                  Text(
                    card.note,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 12, color: t.textMuted),
                  ),
                const SizedBox(height: 9),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: [
                    OutlinedButton.icon(
                      onPressed: busy ? null : onRestore,
                      icon: const Icon(Icons.restore, size: 17),
                      label: const Text('Geri yükle'),
                    ),
                    OutlinedButton.icon(
                      onPressed: busy ? null : onRemove,
                      icon: Icon(
                        trash ? Icons.delete_forever : Icons.delete_outline,
                        size: 17,
                      ),
                      label: Text(trash ? 'Kalıcı sil' : 'Çöpe at'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: t.danger,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.trash});
  final bool trash;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              trash ? Icons.delete_outline : Icons.archive_outlined,
              size: 38,
              color: t.accent,
            ),
            const SizedBox(height: 10),
            Text(
              trash ? 'Çöp kutusu boş' : 'Arşiv boş',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: t.text,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              trash
                  ? 'Silinen kartlar saklama süresi boyunca burada kalır.'
                  : 'Saklamak istediğin kartları arşivleyebilirsin.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, color: t.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
