import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../store.dart';
import '../theme.dart';

Future<void> showDataTransfer(
  BuildContext context, {
  required PlannerStore store,
}) {
  final editor = _DataTransferEditor(store: store);
  if (MediaQuery.sizeOf(context).width >= 640) {
    return showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .45),
      builder: (_) => Dialog(
        backgroundColor: context.tokens.surface,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 650, maxHeight: 720),
          child: editor,
        ),
      ),
    );
  }
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    builder: (_) => FractionallySizedBox(heightFactor: .9, child: editor),
  );
}

class _DataTransferEditor extends StatefulWidget {
  const _DataTransferEditor({required this.store});
  final PlannerStore store;

  @override
  State<_DataTransferEditor> createState() => _DataTransferEditorState();
}

class _DataTransferEditorState extends State<_DataTransferEditor> {
  late String _from = widget.store.dataFrom;
  late String _to = widget.store.dataTo;
  String _format = 'json';
  bool _busy = false;
  String? _message;
  String? _error;

  Future<void> _pickDate(bool start) async {
    final current = parseDay(start ? _from : _to);
    final selected = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: parseDay(addYears(todayKey(), -1)),
      lastDate: parseDay(addYears(todayKey(), 1)),
    );
    if (selected == null) return;
    setState(() {
      if (start) {
        _from = dayKey(selected);
      } else {
        _to = dayKey(selected);
      }
    });
  }

  Future<void> _export() async {
    if (_from.compareTo(_to) > 0) {
      setState(() => _error = 'Geçerli bir tarih aralığı seç.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      final result = await widget.store.api.exportData(_format, _from, _to);
      await FilePicker.saveFile(
        dialogTitle: 'Easy Plan dışa aktarımını kaydet',
        fileName: result.filename,
        type: FileType.custom,
        allowedExtensions: [_format],
        bytes: result.bytes,
      );
      if (mounted) {
        setState(
          () => _message = '${_format.toUpperCase()} dosyası hazırlandı.',
        );
      }
    } on ApiException catch (error) {
      if (mounted) {
        setState(() => _error = 'Dışa aktarılamadı (${error.code}).');
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Dosya kaydedilemedi.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _import() async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['json', 'csv', 'ics'],
    );
    final file = picked.firstOrNull;
    if (file == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 5 * 1024 * 1024) {
        throw const FormatException('file_too_large');
      }
      final result = await widget.store.api.importData(file.name, bytes);
      await widget.store.loadRange();
      if (mounted) {
        setState(() {
          _message =
              '${result.imported} kart içe aktarıldı'
              '${result.skipped > 0 ? ', ${result.skipped} kayıt atlandı' : ''}.';
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = 'İçe aktarılamadı (${error.code}).');
    } on FormatException {
      if (mounted) setState(() => _error = 'Dosya 5 MB sınırını aşıyor.');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'Dosya okunamadı veya biçimi geçersiz.');
      }
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
          title: const Text('İçe / Dışa Aktar'),
          subtitle: const Text('JSON, CSV ve iCalendar'),
          trailing: IconButton(
            onPressed: _busy ? null : () => Navigator.pop(context),
            icon: const Icon(Icons.close),
          ),
        ),
        Divider(height: 1, color: t.border),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Dışa aktar',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 5),
              Text(
                'Seçilen aralıktaki aktif kartlar aktarılır. Görseller pakete dahil edilmez.',
                style: TextStyle(fontSize: 12, color: t.textMuted),
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pickDate(true),
                      icon: const Icon(Icons.calendar_today_outlined, size: 17),
                      label: Text(_from),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: _busy ? null : () => _pickDate(false),
                      icon: const Icon(Icons.event_outlined, size: 17),
                      label: Text(_to),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'json', label: Text('JSON')),
                  ButtonSegment(value: 'csv', label: Text('CSV')),
                  ButtonSegment(value: 'ics', label: Text('iCalendar')),
                ],
                selected: {_format},
                onSelectionChanged: _busy
                    ? null
                    : (values) => setState(() => _format = values.first),
              ),
              const SizedBox(height: 12),
              FilledButton.icon(
                onPressed: _busy ? null : _export,
                icon: const Icon(Icons.download_outlined),
                label: const Text('Dosyayı kaydet'),
              ),
              const SizedBox(height: 24),
              Divider(color: t.border),
              const SizedBox(height: 16),
              Text('İçe aktar', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 5),
              Text(
                'En fazla 5 MB ve 1.000 kart. Mevcut kartların üzerine yazılmaz.',
                style: TextStyle(fontSize: 12, color: t.textMuted),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: _busy ? null : _import,
                icon: const Icon(Icons.upload_file_outlined),
                label: const Text('JSON, CSV veya ICS seç'),
              ),
              if (_message != null) ...[
                const SizedBox(height: 14),
                Text(_message!, style: TextStyle(color: t.cardColor('green'))),
              ],
              if (_error != null) ...[
                const SizedBox(height: 14),
                Text(_error!, style: TextStyle(color: t.danger)),
              ],
            ],
          ),
        ),
        Divider(height: 1, color: t.border),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton(
                onPressed: _busy ? null : () => Navigator.pop(context),
                child: const Text('Kapat'),
              ),
            ),
          ),
        ),
      ],
    );
  }
}
