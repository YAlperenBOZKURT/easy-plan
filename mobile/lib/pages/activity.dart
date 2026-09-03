import 'package:flutter/material.dart';

import '../api/models.dart';
import '../store.dart';
import '../localization.dart';

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
    final strings = context.strings;
    if (item.action == 'moved') {
      final from = item.details['fromDay'];
      final to = item.details['toDay'];
      if (from is String && to is String && from != to) return '$from → $to';
      return strings.text('activity.orderChanged');
    }
    final fields = item.details['fields'];
    if (fields is List && fields.isNotEmpty) {
      return fields
          .map((field) => strings.text('field.$field'))
          .join(', ');
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final strings = context.strings;
    return AlertDialog(
    title: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(strings.text('activity.title')),
        if (widget.card != null)
          Text(
            widget.card!.title.isEmpty
                ? strings.text('activity.untitled')
                : widget.card!.title,
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
          ? Center(child: Text(strings.text('activity.empty')))
          : ListView(
              children: [
                for (final item in _items)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(_icon(item.action), size: 20),
                    title: Text(
                      '${_actor(item, strings)} ${_actionLabel(item.action, strings)}',
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.cardTitle.isEmpty
                              ? strings.text('activity.untitled')
                              : item.cardTitle,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        if (_detail(item) case final detail?) Text(detail),
                        Text(_dateLabel(context, item.createdAt)),
                      ],
                    ),
                  ),
                if (_failed)
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Text(strings.text('activity.failed')),
                  ),
                if (_loading) const Center(child: CircularProgressIndicator()),
                if (!_loading && _cursor != null)
                  OutlinedButton(
                    onPressed: () => _load(more: true),
                    child: Text(strings.text('activity.loadOlder')),
                  ),
              ],
            ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: Text(strings.text('common.close')),
      ),
    ],
    );
  }

  static String _actor(CardActivity item, AppStrings strings) {
    final name = item.actorName?.trim() ?? '';
    if (name.isNotEmpty) return name;
    final email = item.actorEmail?.trim() ?? '';
    return email.isNotEmpty ? email : strings.text('activity.deletedUser');
  }

  static String _dateLabel(BuildContext context, DateTime value) =>
      '${MaterialLocalizations.of(context).formatMediumDate(value)} '
      '${MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(value))}';

  static String _actionLabel(String action, AppStrings strings) {
    const supported = {
      'created', 'updated', 'moved', 'completed', 'reopened',
      'archived', 'trashed', 'restored', 'deleted', 'duplicated',
    };
    return supported.contains(action) ? strings.text('activity.$action') : action;
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
