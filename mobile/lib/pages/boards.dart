import 'package:flutter/material.dart';

import '../api/models.dart';
import '../store.dart';

Future<void> showBoardManager(
  BuildContext context, {
  required PlannerStore store,
}) => showDialog<void>(
  context: context,
  builder: (_) => _BoardManager(store: store),
);

class _BoardManager extends StatefulWidget {
  const _BoardManager({required this.store});
  final PlannerStore store;

  @override
  State<_BoardManager> createState() => _BoardManagerState();
}

class _BoardManagerState extends State<_BoardManager> {
  final _name = TextEditingController();
  late final TextEditingController _boardName;
  final _email = TextEditingController();
  List<BoardMember> _members = const [];
  String _role = 'editor';
  bool _busy = false;
  String? _error;

  PlannerStore get store => widget.store;
  PlannerBoard? get board => store.activeBoard;

  @override
  void initState() {
    super.initState();
    _boardName = TextEditingController(text: board?.name ?? '');
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    _boardName.dispose();
    _email.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final selected = board;
    if (selected == null) return;
    try {
      final members = await store.api.boardMembers(selected.id);
      if (mounted) setState(() => _members = members);
    } catch (_) {
      if (mounted) setState(() => _error = 'Üyeler yüklenemedi.');
    }
  }

  Future<void> _run(Future<void> Function() operation) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await operation();
      await store.loadBoards(preferredId: store.activeBoard?.id);
      await _load();
    } on ApiException catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.code == 'user_not_found'
            ? 'Bu e-posta ile aktif bir Easy Plan hesabı bulunamadı.'
            : 'İşlem tamamlanamadı (${error.code}).';
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'İşlem tamamlanamadı.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create() => _run(() async {
    final previousId = store.activeBoard?.id;
    final created = await store.api.createBoard(_name.text.trim());
    _name.clear();
    await store.loadBoards(preferredId: previousId);
    final target = store.boards.firstWhere((board) => board.id == created.id);
    await store.switchBoard(target);
  });

  Future<void> _deleteOrLeave(PlannerBoard selected) async {
    final verb = selected.isOwner ? 'silinsin' : 'ayrılmak istiyor musun';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(selected.isOwner ? 'Panoyu sil' : 'Panodan ayrıl'),
        content: Text(
          selected.isOwner
              ? '“${selected.name}” ve içindeki tüm kartlar kalıcı olarak $verb?'
              : '“${selected.name}” panosundan $verb?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(selected.isOwner ? 'Sil' : 'Ayrıl'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _run(
      () => selected.isOwner
          ? store.deleteBoard(selected)
          : store.leaveBoard(selected),
    );
    if (mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final selected = board;
    if (selected == null) {
      return const AlertDialog(
        content: Center(child: CircularProgressIndicator()),
      );
    }
    return AlertDialog(
      title: const Text('Pano ve paylaşım'),
      content: SizedBox(
        width: 620,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: _name,
                maxLength: 80,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Yeni paylaşılan pano',
                ),
              ),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: _busy || _name.text.trim().isEmpty
                      ? null
                      : _create,
                  icon: const Icon(Icons.add),
                  label: const Text('Oluştur'),
                ),
              ),
              const Divider(height: 28),
              Text('${selected.name} · ${_roleLabel(selected.role)}'),
              const SizedBox(height: 12),
              if (selected.isOwner) ...[
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _boardName,
                        maxLength: 80,
                        decoration: const InputDecoration(
                          labelText: 'Pano adı',
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: _busy
                          ? null
                          : () => _run(
                              () => store.renameBoard(
                                selected,
                                _boardName.text.trim(),
                              ),
                            ),
                      child: const Text('Kaydet'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
              ],
              if (selected.isOwner && !selected.personal) ...[
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  onChanged: (_) => setState(() {}),
                  decoration: const InputDecoration(labelText: 'Üye e-postası'),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _role,
                        decoration: const InputDecoration(labelText: 'Yetki'),
                        items: const [
                          DropdownMenuItem(
                            value: 'editor',
                            child: Text('Düzenleyici'),
                          ),
                          DropdownMenuItem(
                            value: 'viewer',
                            child: Text('Görüntüleyici'),
                          ),
                        ],
                        onChanged: (value) =>
                            setState(() => _role = value ?? 'editor'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _busy || _email.text.trim().isEmpty
                          ? null
                          : () => _run(() async {
                              _members = await store.api.addBoardMember(
                                selected.id,
                                _email.text.trim(),
                                _role,
                              );
                              _email.clear();
                            }),
                      child: const Text('Ekle'),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
              ],
              for (final member in _members)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(member.name.isEmpty ? member.email : member.name),
                  subtitle: member.name.isEmpty ? null : Text(member.email),
                  trailing: selected.isOwner && member.role != 'owner'
                      ? Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            DropdownButton<String>(
                              value: member.role,
                              items: const [
                                DropdownMenuItem(
                                  value: 'editor',
                                  child: Text('Düzenleyici'),
                                ),
                                DropdownMenuItem(
                                  value: 'viewer',
                                  child: Text('Görüntüleyici'),
                                ),
                              ],
                              onChanged: _busy
                                  ? null
                                  : (role) {
                                      if (role != null) {
                                        _run(() async {
                                          _members = await store.api
                                              .updateBoardMember(
                                                selected.id,
                                                member.userId,
                                                role,
                                              );
                                        });
                                      }
                                    },
                            ),
                            IconButton(
                              tooltip: 'Üyeyi çıkar',
                              onPressed: _busy
                                  ? null
                                  : () => _run(
                                      () => store.api.removeBoardMember(
                                        selected.id,
                                        member.userId,
                                      ),
                                    ),
                              icon: const Icon(Icons.person_remove_outlined),
                            ),
                          ],
                        )
                      : Text(_roleLabel(member.role)),
                ),
              if (_error case final error?)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    error,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                ),
              if (!selected.personal) ...[
                const SizedBox(height: 16),
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _deleteOrLeave(selected),
                  icon: Icon(
                    selected.isOwner ? Icons.delete_outline : Icons.logout,
                  ),
                  label: Text(
                    selected.isOwner ? 'Panoyu kalıcı sil' : 'Panodan ayrıl',
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Kapat'),
        ),
      ],
    );
  }

  static String _roleLabel(String role) => switch (role) {
    'owner' => 'Sahip',
    'editor' => 'Düzenleyici',
    _ => 'Görüntüleyici',
  };
}
