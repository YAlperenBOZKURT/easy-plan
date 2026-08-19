import 'dart:async';

import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../search.dart';
import '../store.dart';
import '../tags.dart';
import '../theme.dart';

Future<PlannerCard?> showCardSearch(
  BuildContext context, {
  required PlannerStore store,
}) {
  final view = _CardSearch(store: store);
  if (MediaQuery.sizeOf(context).width >= 640) {
    return showDialog<PlannerCard>(
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
            maxWidth: 620,
            maxHeight: MediaQuery.sizeOf(context).height * .82,
          ),
          child: view,
        ),
      ),
    );
  }

  return showModalBottomSheet<PlannerCard>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.tokens.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
    ),
    builder: (_) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: FractionallySizedBox(heightFactor: .92, child: view),
    ),
  );
}

class _CardSearch extends StatefulWidget {
  const _CardSearch({required this.store});

  final PlannerStore store;

  @override
  State<_CardSearch> createState() => _CardSearchState();
}

class _CardSearchState extends State<_CardSearch> {
  final _input = TextEditingController();
  Timer? _debounce;
  List<PlannerCard> _results = const [];
  bool _loading = false;
  bool _searched = false;
  bool _offline = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _input.dispose();
    super.dispose();
  }

  void _search(String rawQuery) {
    _debounce?.cancel();
    final query = normalizeSearchQuery(rawQuery);
    if (query.length < minSearchQueryLength) {
      setState(() {
        _results = const [];
        _loading = false;
        _searched = false;
        _offline = false;
      });
      return;
    }

    setState(() => _loading = true);
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      final result = await widget.store.searchCards(query);
      if (!mounted || normalizeSearchQuery(_input.text) != query) return;
      setState(() {
        _results = result.cards;
        _offline = result.offline;
        _loading = false;
        _searched = true;
      });
    });
  }

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
              Text(
                'Kartlarda ara',
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: t.text,
                ),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Kapat',
                icon: Icon(Icons.close, size: 20, color: t.textMuted),
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(18, 14, 18, 8),
          child: TextField(
            controller: _input,
            autofocus: true,
            maxLength: maxSearchQueryLength,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Başlık veya not yaz…',
              counterText: '',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: _loading
                  ? const Padding(
                      padding: EdgeInsets.all(14),
                      child: SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    )
                  : _input.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Aramayı temizle',
                      icon: const Icon(Icons.close, size: 18),
                      onPressed: () {
                        _input.clear();
                        _search('');
                      },
                    ),
            ),
            onChanged: (value) {
              _search(value);
              setState(() {});
            },
          ),
        ),
        if (_offline && _searched)
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 0, 18, 7),
            child: Row(
              children: [
                Icon(Icons.cloud_off, size: 14, color: t.cardColor('amber')),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Çevrimdışı · yerel kartlarda arandı',
                    style: TextStyle(
                      fontSize: 11.5,
                      color: t.cardColor('amber'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        Expanded(
          child: _results.isNotEmpty
              ? ListView.separated(
                  padding: const EdgeInsets.fromLTRB(18, 5, 18, 18),
                  itemCount: _results.length,
                  separatorBuilder: (_, _) => Divider(height: 1, color: t.border),
                  itemBuilder: (context, index) => _SearchResult(
                    card: _results[index],
                    onTap: () => Navigator.of(context).pop(_results[index]),
                  ),
                )
              : Center(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Text(
                      !_searched
                          ? 'Aramak için en az 2 karakter yaz.'
                          : 'Eşleşen kart bulunamadı.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 13, color: t.textFaint),
                    ),
                  ),
                ),
        ),
      ],
    );
  }
}

class _SearchResult extends StatelessWidget {
  const _SearchResult({required this.card, required this.onTap});

  final PlannerCard card;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.sm),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 11),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    card.title.isEmpty ? '(başlıksız)' : card.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      color: t.text,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Text(
                  '${dayName(card.day)} · ${shortDate(card.day)}',
                  style: TextStyle(fontSize: 11, color: t.textFaint),
                ),
              ],
            ),
            if (card.note.isNotEmpty) ...[
              const SizedBox(height: 4),
              Text(
                card.note,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: t.textMuted,
                ),
              ),
            ],
            if (card.priority != 'none' || card.tags.isNotEmpty) ...[
              const SizedBox(height: 7),
              Wrap(
                spacing: 5,
                runSpacing: 5,
                children: [
                  if (card.priority != 'none')
                    Text(
                      cardPriorityLabel(card.priority),
                      style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w600,
                        color: t.textFaint,
                      ),
                    ),
                  for (final tag in card.tags.take(4))
                    Builder(
                      builder: (_) {
                        final color = t.cardColor(
                          cardColorKeys[tagColorIndex(tag)],
                        );
                        return Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 7,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: Color.alphaBlend(
                              color.withValues(alpha: .13),
                              t.surface,
                            ),
                            border: Border.all(
                              color: color.withValues(alpha: .35),
                            ),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            tag,
                            style: TextStyle(
                              fontSize: 10.5,
                              fontWeight: FontWeight.w600,
                              color: Color.alphaBlend(
                                color.withValues(alpha: .78),
                                t.text,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
