import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/models.dart';
import '../cache.dart';
import '../dates.dart';
import '../store.dart';
import '../tags.dart';
import '../theme.dart';

Future<void> showCardTemplates(
  BuildContext context, {
  required PlannerStore store,
}) {
  final editor = _CardTemplatesEditor(store: store);
  if (MediaQuery.sizeOf(context).width >= 640) {
    return showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .45),
      builder: (_) => Dialog(
        backgroundColor: context.tokens.surface,
        insetPadding: const EdgeInsets.all(24),
        child: ConstrainedBox(
          constraints: BoxConstraints(
            maxWidth: 680,
            maxHeight: MediaQuery.sizeOf(context).height * .9,
          ),
          child: editor,
        ),
      ),
    );
  }
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    builder: (_) => FractionallySizedBox(heightFactor: .94, child: editor),
  );
}

class _CardTemplatesEditor extends StatefulWidget {
  const _CardTemplatesEditor({required this.store});
  final PlannerStore store;

  @override
  State<_CardTemplatesEditor> createState() => _CardTemplatesEditorState();
}

class _CardTemplatesEditorState extends State<_CardTemplatesEditor> {
  final _name = TextEditingController();
  final _title = TextEditingController();
  final _note = TextEditingController();
  final _tagInput = TextEditingController();
  final List<TextEditingController> _checklist = [];
  List<CardTemplate> _templates = [];
  List<String> _tags = [];
  List<String> _tagSuggestions = [];
  CardTemplate? _selected;
  String? _startTime;
  String? _endTime;
  String _color = 'blue';
  String _priority = 'none';
  List<int> _reminders = [];
  List<CardImage> _images = [];
  bool _loading = true;
  bool _busy = false;
  String? _error;
  String? _tagError;

  @override
  void initState() {
    super.initState();
    _load();
    _loadTagSuggestions();
  }

  @override
  void dispose() {
    _name.dispose();
    _title.dispose();
    _note.dispose();
    _tagInput.dispose();
    for (final controller in _checklist) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _load([String? preferredId]) async {
    try {
      final templates = await widget.store.api.cardTemplates();
      if (!mounted) return;
      setState(() {
        _templates = templates;
        _loading = false;
      });
      final selected = templates
          .where((item) => item.id == (preferredId ?? _selected?.id))
          .firstOrNull;
      _fill(selected ?? templates.firstOrNull);
    } catch (_) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = 'Şablonlar yüklenemedi.';
        });
      }
    }
  }

  void _fill(CardTemplate? template) {
    for (final controller in _checklist) {
      controller.dispose();
    }
    _checklist.clear();
    if (template != null) {
      _checklist.addAll(
        template.checklist.map(
          (item) => TextEditingController(text: item.text),
        ),
      );
    }
    if (!mounted) return;
    setState(() {
      _selected = template;
      _name.text = template?.name ?? '';
      _title.text = template?.title ?? '';
      _note.text = template?.note ?? '';
      _tags = [...?template?.tags];
      _startTime = template?.startTime;
      _endTime = template?.endTime;
      _color = template?.color ?? 'blue';
      _priority = template?.priority ?? 'none';
      _reminders = [...?template?.reminders];
      _images = [...?template?.images];
      _error = null;
      _tagError = null;
    });
  }

  Future<void> _loadTagSuggestions() async {
    try {
      final suggestions = await widget.store.api.tags();
      if (mounted) setState(() => _tagSuggestions = suggestions);
    } catch (_) {
      // Etiket ekleme çevrimdışı da çalışır; öneriler zorunlu değildir.
    }
  }

  void _addTag([String? value]) {
    final result = addCardTag(_tags, value ?? _tagInput.text);
    setState(() {
      _tagError = result.error;
      if (result.error == null) {
        _tags = result.tags;
        _tagInput.clear();
      }
    });
  }

  Future<void> _save() async {
    final template = _selected;
    if (template == null || _name.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await widget.store.api.updateCardTemplate(template.id, {
        'name': _name.text.trim(),
        'title': _title.text.trim(),
        'note': _note.text.trim(),
        'startTime': _startTime,
        'endTime': _endTime,
        'color': _color,
        'priority': _priority,
        'tags': _tags,
        'reminders': _reminders,
        'checklist': [
          for (final controller in _checklist)
            if (controller.text.trim().isNotEmpty)
              {'id': newUuid(), 'text': controller.text.trim(), 'done': false},
        ],
      });
      await _load(template.id);
      await widget.store.loadRange();
    } catch (_) {
      if (mounted) setState(() => _error = 'Şablon kaydedilemedi.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _create() async {
    setState(() => _busy = true);
    try {
      final created = await widget.store.api.createCardTemplate({
        'name': 'Yeni şablon',
        'color': 'blue',
      });
      await _load(created.id);
    } catch (_) {
      if (mounted) setState(() => _error = 'Şablon oluşturulamadı.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final template = _selected;
    if (template == null) return;
    final approved = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Şablonu sil'),
        content: Text(
          '${template.name} silinsin mi? Bağlı kartlar mevcut hâliyle kalır.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Vazgeç'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Sil'),
          ),
        ],
      ),
    );
    if (approved != true) return;
    setState(() => _busy = true);
    try {
      await widget.store.api.deleteCardTemplate(template.id);
      await _load();
      await widget.store.loadRange();
    } catch (_) {
      if (mounted) setState(() => _error = 'Şablon silinemedi.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickTime(bool start) async {
    final current = start ? _startTime : _endTime;
    final parts = current?.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: parts?.length == 2
          ? TimeOfDay(hour: int.parse(parts![0]), minute: int.parse(parts[1]))
          : const TimeOfDay(hour: 9, minute: 0),
    );
    if (picked == null) return;
    setState(() {
      final value = '${two(picked.hour)}:${two(picked.minute)}';
      if (start) {
        _startTime = value;
      } else {
        _endTime = value;
      }
    });
  }

  Future<void> _addImages() async {
    final template = _selected;
    if (template == null) return;
    try {
      final picked = await ImagePicker().pickMultiImage(imageQuality: 92);
      if (picked.isEmpty) return;
      final files = <({String name, Uint8List bytes})>[];
      for (final image in picked) {
        files.add((name: image.name, bytes: await image.readAsBytes()));
      }
      setState(() => _busy = true);
      await widget.store.api.uploadCardTemplateImages(template.id, files);
      await _load(template.id);
      await widget.store.loadRange();
    } on ApiException catch (error) {
      if (mounted) {
        setState(() {
          _error = error.statusCode == 404
              ? 'Şablon görsel servisi sunucuda bulunamadı. Sunucuyu güncelleyip yeniden başlat.'
              : 'Görseller eklenemedi (${error.code}).';
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Görseller eklenemedi: sunucuya ulaşılamadı.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeImage(CardImage image) async {
    final template = _selected;
    if (template == null) return;
    setState(() => _busy = true);
    try {
      await widget.store.api.deleteCardTemplateImage(image.id);
      await _load(template.id);
      await widget.store.loadRange();
    } catch (_) {
      if (mounted) setState(() => _error = 'Görsel kaldırılamadı.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Column(
      children: [
        ListTile(
          title: const Text('Şablonlar'),
          subtitle: const Text(
            'Kaydedilen değişiklikler bağlı kartlara uygulanır.',
          ),
          trailing: IconButton(
            icon: const Icon(Icons.close),
            onPressed: () => Navigator.pop(context),
          ),
        ),
        Divider(height: 1, color: t.border),
        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator()))
        else
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        initialValue: _selected?.id,
                        hint: const Text('Henüz şablon yok'),
                        items: _templates
                            .map(
                              (template) => DropdownMenuItem(
                                value: template.id,
                                child: Text(
                                  template.name,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: _busy
                            ? null
                            : (id) => _fill(
                                _templates
                                    .where((item) => item.id == id)
                                    .firstOrNull,
                              ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Yeni şablon',
                      onPressed: _busy ? null : _create,
                      icon: const Icon(Icons.add),
                    ),
                    IconButton(
                      tooltip: 'Şablonu sil',
                      onPressed: _selected == null || _busy ? null : _delete,
                      icon: Icon(Icons.delete_outline, color: t.danger),
                    ),
                  ],
                ),
                if (_selected != null) ...[
                  const SizedBox(height: 16),
                  TextField(
                    controller: _name,
                    maxLength: 100,
                    decoration: const InputDecoration(labelText: 'Şablon adı'),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _title,
                    maxLength: 200,
                    decoration: const InputDecoration(
                      labelText: 'Kart başlığı',
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: _note,
                    maxLength: 5000,
                    maxLines: 3,
                    decoration: const InputDecoration(labelText: 'Not'),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => _pickTime(true),
                          child: Text(_startTime ?? 'Başlangıç'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton(
                          onPressed: () => _pickTime(false),
                          child: Text(_endTime ?? 'Bitiş'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final key in cardColorKeys)
                        InkWell(
                          onTap: () => setState(() => _color = key),
                          child: CircleAvatar(
                            radius: 16,
                            backgroundColor: t.cardColor(key),
                            child: _color == key
                                ? const Icon(Icons.check, size: 16)
                                : null,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: _priority,
                    decoration: const InputDecoration(labelText: 'Öncelik'),
                    items: [
                      for (final key in cardPriorityKeys)
                        DropdownMenuItem(
                          value: key,
                          child: Text(cardPriorityLabel(key)),
                        ),
                    ],
                    onChanged: (value) => value == null
                        ? null
                        : setState(() => _priority = value),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      const Expanded(child: Text('Etiketler')),
                      Text(
                        '${_tags.length}/$maxCardTags',
                        style: TextStyle(fontSize: 12, color: t.textMuted),
                      ),
                    ],
                  ),
                  if (_tags.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        for (final tag in _tags)
                          InputChip(
                            label: Text(tag),
                            backgroundColor: t
                                .cardColor(cardColorKeys[tagColorIndex(tag)])
                                .withValues(alpha: .15),
                            onDeleted: _busy
                                ? null
                                : () => setState(() {
                                    _tags.remove(tag);
                                    _tagError = null;
                                  }),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 8),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _tagInput,
                          maxLength: maxTagLength,
                          textInputAction: TextInputAction.done,
                          decoration: InputDecoration(
                            hintText: 'Örn. Backend',
                            errorText: _tagError,
                            counterText: '',
                          ),
                          onSubmitted: _addTag,
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: _busy || _tags.length >= maxCardTags
                            ? null
                            : _addTag,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(64, 48),
                        ),
                        child: const Text('Ekle'),
                      ),
                    ],
                  ),
                  if (_tagSuggestions.any(
                    (suggestion) =>
                        !_tags.any((tag) => tagKey(tag) == tagKey(suggestion)),
                  )) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        for (final suggestion
                            in _tagSuggestions
                                .where(
                                  (suggestion) => !_tags.any(
                                    (tag) => tagKey(tag) == tagKey(suggestion),
                                  ),
                                )
                                .take(6))
                          ActionChip(
                            label: Text(suggestion),
                            avatar: const Icon(Icons.add, size: 15),
                            onPressed: _busy || _tags.length >= maxCardTags
                                ? null
                                : () => _addTag(suggestion),
                          ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Text('Checklist'),
                      const Spacer(),
                      Text(
                        '${_checklist.length}/50',
                        style: TextStyle(color: t.textMuted),
                      ),
                    ],
                  ),
                  for (var index = 0; index < _checklist.length; index++)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: _checklist[index],
                              maxLength: 500,
                              decoration: const InputDecoration(
                                counterText: '',
                                hintText: 'Madde',
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () {
                              final removed = _checklist.removeAt(index);
                              removed.dispose();
                              setState(() {});
                            },
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                    ),
                  TextButton.icon(
                    onPressed: _checklist.length >= 50
                        ? null
                        : () => setState(
                            () => _checklist.add(TextEditingController()),
                          ),
                    icon: const Icon(Icons.add),
                    label: const Text('Madde ekle'),
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 7,
                    children: [
                      for (final option in reminderOptions)
                        FilterChip(
                          label: Text(option.label),
                          selected: _reminders.contains(option.minutes),
                          onSelected: (selected) => setState(() {
                            if (selected) {
                              _reminders.add(option.minutes);
                            } else {
                              _reminders.remove(option.minutes);
                            }
                          }),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      const Text('Görseller'),
                      const Spacer(),
                      TextButton.icon(
                        onPressed: _busy ? null : _addImages,
                        icon: const Icon(Icons.add_photo_alternate_outlined),
                        label: const Text('Ekle'),
                      ),
                    ],
                  ),
                  if (_images.isNotEmpty)
                    SizedBox(
                      height: 92,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _images.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (_, index) {
                          final image = _images[index];
                          return Stack(
                            children: [
                              ClipRRect(
                                borderRadius: BorderRadius.circular(8),
                                child: Image.network(
                                  '${widget.store.api.baseUrl}${image.thumbUrl}',
                                  headers: widget.store.api.imageHeaders,
                                  width: 92,
                                  height: 92,
                                  fit: BoxFit.cover,
                                ),
                              ),
                              Positioned(
                                right: 2,
                                top: 2,
                                child: IconButton.filledTonal(
                                  iconSize: 16,
                                  onPressed: _busy
                                      ? null
                                      : () => _removeImage(image),
                                  icon: const Icon(Icons.close),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                  const SizedBox(height: 14),
                  Text(
                    'Bağlı kartta yapılan en küçük değişiklik şablon bağlantısını kalıcı olarak kaldırır.',
                    style: TextStyle(fontSize: 12, color: t.textMuted),
                  ),
                ],
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(_error!, style: TextStyle(color: t.danger)),
                  ),
              ],
            ),
          ),
        Divider(height: 1, color: t.border),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton(
                  onPressed: _busy ? null : () => Navigator.pop(context),
                  child: const Text('Kapat'),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _selected == null || _busy ? null : _save,
                  child: Text(
                    _busy ? 'Kaydediliyor…' : 'Değişiklikleri kaydet',
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
