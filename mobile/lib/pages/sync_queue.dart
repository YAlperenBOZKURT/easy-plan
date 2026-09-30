import 'package:flutter/material.dart';
import '../api/models.dart';
import '../localization.dart';
import '../store.dart';
import '../sync_queue.dart';

class SyncQueueSheet extends StatefulWidget {
  const SyncQueueSheet({super.key, required this.store});
  final PlannerStore store;
  @override
  State<SyncQueueSheet> createState() => _SyncQueueSheetState();
}

class _SyncQueueSheetState extends State<SyncQueueSheet> {
  bool busy = false;
  Future<void> run(Future<void> Function() action) async {
    setState(() => busy = true);
    try {
      await action();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(AppStrings.of(context).text('conflict.failed')),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> discard(PendingWrite item) async {
    final s = AppStrings.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(s.text('conflict.cancel')),
        content: Text(s.text('conflict.cancelHint')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: Text(s.text('common.close')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(s.text('conflict.cancel')),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await run(() => widget.store.discardCardWrites(item.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(context);
    return SafeArea(
      child: ListenableBuilder(
        listenable: widget.store,
        builder: (context, _) => Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      s.text('conflict.queue'),
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    tooltip: s.text('common.close'),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(
                  children: [
                    for (final item in widget.store.pendingQueue) ...[
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(
                          item.draft?.title ??
                              item.original?.title ??
                              s.text('conflict.pending'),
                        ),
                        subtitle: Text(
                          s.text(
                            item.conflict
                                ? 'conflict.title'
                                : item.failure != null
                                ? 'conflict.failed'
                                : 'conflict.pending',
                          ),
                        ),
                      ),
                      if (item.conflict) ...[
                        Text(s.text('conflict.hint')),
                        if (item.path.endsWith('/move'))
                          Text(
                            s
                                .text('conflict.move')
                                .replaceAll('{day}', item.draft!.day),
                          ),
                        _Comparison(
                          local: item.draft!,
                          server: item.serverCard!,
                        ),
                        Wrap(
                          spacing: 8,
                          children: [
                            FilledButton(
                              onPressed: busy
                                  ? null
                                  : () => run(
                                      () =>
                                          widget.store.keepLocalWrite(item.id),
                                    ),
                              child: Text(s.text('conflict.keep')),
                            ),
                            TextButton(
                              onPressed: busy ? null : () => discard(item),
                              child: Text(s.text('conflict.useServer')),
                            ),
                          ],
                        ),
                      ] else
                        TextButton(
                          onPressed: busy ? null : () => discard(item),
                          child: Text(s.text('conflict.cancel')),
                        ),
                      const Divider(),
                    ],
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: FilledButton(
                onPressed: busy
                    ? null
                    : () => run(widget.store.refreshFromServer),
                child: Text(s.text('conflict.retry')),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Comparison extends StatelessWidget {
  const _Comparison({required this.local, required this.server});
  final PlannerCard local;
  final PlannerCard server;
  @override
  Widget build(BuildContext context) {
    final s = AppStrings.of(context);
    final fields = <String, String Function(PlannerCard)>{
      'conflict.titleField': (c) => c.title,
      'conflict.note': (c) => c.note,
      'conflict.day': (c) => c.day,
      'conflict.time': (c) => c.timeLabel,
      'conflict.color': (c) => c.color,
      'conflict.priority': (c) => c.priority,
      'conflict.deadline': (c) => c.deadlineAt ?? '',
      'conflict.tags': (c) => c.tags.join(', '),
      'conflict.checklist': (c) =>
          c.checklist.map((i) => '${i.done ? '☑' : '☐'} ${i.text}').join('\n'),
      'conflict.reminders': (c) => c.reminders.join(', '),
      'conflict.state': (c) =>
          s.text(c.done ? 'conflict.done' : 'conflict.open'),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Table(
        columnWidths: const {
          0: FlexColumnWidth(1),
          1: FlexColumnWidth(2),
          2: FlexColumnWidth(2),
        },
        children: [
          TableRow(
            children: [
              const SizedBox(),
              Text(s.text('conflict.local')),
              Text(s.text('conflict.server')),
            ],
          ),
          for (final field in fields.entries)
            if (field.value(local) != field.value(server))
              TableRow(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(6),
                    child: Text(s.text(field.key)),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(6),
                    child: Text(
                      field.value(local).isEmpty ? '—' : field.value(local),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(6),
                    child: Text(
                      field.value(server).isEmpty ? '—' : field.value(server),
                    ),
                  ),
                ],
              ),
        ],
      ),
    );
  }
}
