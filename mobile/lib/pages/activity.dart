import 'package:flutter/material.dart';

import '../api/models.dart';
import '../store.dart';

Future<void> showActivityHistory(
  BuildContext context, {
  required PlannerStore store,
  PlannerCard? card,
}) => showDialog<void>(
  context: context,
  builder: (_) => _ActivityDialog(store: store, card: card),
);

class _ActivityDialog extends StatefulWidget {
  const _ActivityDialog({required this.store, this.card});
  final PlannerStore store;
  final PlannerCard? card;

  @override
  State<_ActivityDialog> createState() => _ActivityDialogState();
}

class _ActivityDialogState extends State<_ActivityDialog> {
  final List<CardActivity> _items = [];
  String? _cursor;
  bool _loading = true;
  bool _failed = false;

  static const _actions = <String, String>{
    'created': 'kartı oluşturdu',
    'updated': 'kartı düzenledi',
    'moved': 'kartı taşıdı',
    'completed': 'kartı tamamladı',
    'reopened': 'kartı yeniden açtı',
    'archived': 'kartı arşivledi',
    'trashed': 'kartı çöpe attı',
    'restored': 'kartı geri yükledi',
    'deleted': 'kartı kalıcı olarak sildi',
    'duplicated': 'kartı çoğalttı',
  };

  static const _fields = <String, String>{
    'day': 'gün',
    'title': 'başlık',
    'note': 'not',
    'startTime': 'başlangıç',
    'endTime': 'bitiş',
    'color': 'renk',
    'done': 'durum',
    'checklist': 'checklist',
    'priority': 'öncelik',
    'deadlineAt': 'son tarih',
    'tags': 'etiketler',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool more = false}) async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final result = await widget.store.api.cardActivity(
        before: more ? _cursor : null,
        cardId: widget.card?.id,
      );
      if (!mounted) return;
      setState(() {
        if (!more) _items.clear();
        _items.addAll(result.activities);
        _cursor = result.nextCursor;
      });
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String? _detail(CardActivity item) {
    if (item.action == 'moved') {
      final from = item.details['fromDay'];
      final to = item.details['toDay'];
      if (from is String && to is String && from != to) return '$from → $to';
      return 'Kart sırası değiştirildi';
    }
    final fields = item.details['fields'];
    if (fields is List && fields.isNotEmpty) {
      return fields.map((field) => _fields['$field'] ?? '$field').join(', ');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Etkinlik geçmişi'),
        if (widget.card != null)
          Text(
            widget.card!.title.isEmpty ? 'Başlıksız kart' : widget.card!.title,
            style: Theme.of(context).textTheme.bodySmall,
          ),
      ],
    ),
    content: SizedBox(
      width: 620,
      height: 560,
      child: _items.isEmpty && _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty && !_failed
          ? const Center(child: Text('Henüz etkinlik yok.'))
          : ListView(
              children: [
                for (final item in _items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(_icon(item.action), size: 20),
                    title: Text(
                      '${_actor(item)} ${_actions[item.action] ?? item.action}',
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.cardTitle.isEmpty
                              ? 'Başlıksız kart'
                              : item.cardTitle,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (_detail(item) case final detail?) Text(detail),
                        Text(_dateLabel(item.createdAt)),
                      ],
                    ),
                  ),
                if (_failed)
                  const Padding(
                    padding: EdgeInsets.all(12),
                    child: Text('Etkinlik geçmişi yüklenemedi.'),
                  ),
                if (_loading) const Center(child: CircularProgressIndicator()),
                if (!_loading && _cursor != null)
                  OutlinedButton(
                    onPressed: () => _load(more: true),
                    child: const Text('Daha eski etkinlikleri yükle'),
                  ),
              ],
            ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Kapat'),
      ),
    ],
  );

  static String _actor(CardActivity item) {
    final name = item.actorName?.trim() ?? '';
    if (name.isNotEmpty) return name;
    final email = item.actorEmail?.trim() ?? '';
    return email.isNotEmpty ? email : 'Silinmiş kullanıcı';
  }

  static String _dateLabel(DateTime value) {
    const months = [
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
    final hour = value.hour.toString().padLeft(2, '0');
    final minute = value.minute.toString().padLeft(2, '0');
    return '${value.day} ${months[value.month - 1]} ${value.year} $hour:$minute';
  }

  static IconData _icon(String action) => switch (action) {
    'created' => Icons.add_circle_outline,
    'completed' => Icons.check_circle_outline,
    'moved' => Icons.drive_file_move_outline,
    'archived' => Icons.archive_outlined,
    'trashed' || 'deleted' => Icons.delete_outline,
    'restored' => Icons.restore,
    'duplicated' => Icons.copy_outlined,
    _ => Icons.edit_outlined,
  };
}
