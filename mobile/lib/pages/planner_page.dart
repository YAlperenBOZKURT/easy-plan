import 'dart:async';

import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/gestures.dart'
    show PointerScrollEvent, PointerSignalEvent;
import 'package:flutter/material.dart';

import '../api/models.dart';
import '../dates.dart';
import '../store.dart';
import '../theme.dart';
import '../widgets/draggable_card.dart';
import 'card_editor.dart';
import 'card_search.dart';
import 'card_view.dart';

/// Ana ekran: bugünden başlayan 7 gün.
/// Telefonda tek gün + kaydırma, geniş ekranda kolonlar yan yana.
class PlannerPage extends StatefulWidget {
  const PlannerPage({super.key, required this.store});
  final PlannerStore store;

  @override
  State<PlannerPage> createState() => _PlannerPageState();
}

class _PlannerPageState extends State<PlannerPage> with WidgetsBindingObserver {
  late final PageController _pages = PageController();
  int _index = 0;

  /// Masaüstünde: fareyle sürükleyerek hızlı gün gezme.
  bool _fastNav = false;
  int _panDir = 0; // +1 ileri (yeşil), -1 geri (kırmızı)
  double _panTotal = 0;

  /// Kart sürüklenirken pano kaymasın.
  bool _cardDragging = false;

  bool get _isDesktopLayout =>
      defaultTargetPlatform == TargetPlatform.windows ||
      defaultTargetPlatform == TargetPlatform.linux ||
      defaultTargetPlatform == TargetPlatform.macOS;

  PlannerStore get store => widget.store;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Başka cihazdaki değişiklik kendiliğinden gelsin.
    store.startAutoSync();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Uygulamaya geri dönünce hemen tazele.
    if (state == AppLifecycleState.resumed) store.refreshFromServer();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    store.stopAutoSync();
    _pages.dispose();
    super.dispose();
  }

  Future<void> _openEditor({PlannerCard? card, required String day}) async {
    final saved = await showCardEditor(
      context,
      store: store,
      card: card,
      day: day,
    );
    if (saved == true && mounted) setState(() {});
  }

  Future<void> _openSearch() async {
    final card = await showCardSearch(context, store: store);
    if (card == null || !mounted) return;
    final result = await showCardView(context, store: store, card: card);
    if (result == 'edit' && mounted) {
      await _openEditor(card: card, day: card.day);
    }
  }

  void _cardActions(PlannerCard card) {
    final t = context.tokens;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: t.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(R.xl)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 6),
            Container(
              width: 38,
              height: 4,
              decoration: BoxDecoration(
                color: t.borderStrong,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
            const SizedBox(height: 10),
            ListTile(
              leading: Icon(Icons.edit_outlined, color: t.cardColor('blue')),
              title: const Text('Düzenle'),
              onTap: () {
                Navigator.pop(sheetContext);
                _openEditor(card: card, day: card.day);
              },
            ),
            ListTile(
              leading: Icon(
                Icons.article_outlined,
                color: t.cardColor('violet'),
              ),
              title: const Text('İncele'),
              onTap: () async {
                Navigator.pop(sheetContext);
                final result = await showCardView(
                  context,
                  store: store,
                  card: card,
                );
                if (result == 'edit' && mounted) {
                  _openEditor(card: card, day: card.day);
                }
              },
            ),
            ListTile(
              leading: Icon(
                card.done ? Icons.undo : Icons.check_circle_outline,
                color: t.cardColor('green'),
              ),
              title: Text(card.done ? 'Geri al' : 'Yapıldı'),
              onTap: () {
                Navigator.pop(sheetContext);
                store.toggleDone(card);
              },
            ),
            ListTile(
              leading: Icon(Icons.delete_outline, color: t.danger),
              title: Text('Sil', style: TextStyle(color: t.danger)),
              onTap: () {
                Navigator.pop(sheetContext);
                store.deleteCard(card);
              },
            ),
            const SizedBox(height: 6),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;

    return ListenableBuilder(
      listenable: store,
      builder: (context, _) {
        final days = store.days;
        final wide = MediaQuery.sizeOf(context).width >= 768;

        return Scaffold(
          appBar: AppBar(
            titleSpacing: 8,
            title: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                IconButton(
                  onPressed: () => _shift(-1),
                  icon: const Icon(Icons.chevron_left),
                  tooltip: 'Önceki gün',
                ),
                IconButton(
                  onPressed: () => _shift(1),
                  icon: const Icon(Icons.chevron_right),
                  tooltip: 'Sonraki gün',
                ),
                OutlinedButton(
                  onPressed: () {
                    store.goToday();
                    _pages.jumpToPage(0);
                    setState(() => _index = 0);
                  },
                  child: const Text('Bugün'),
                ),
                if (wide) ...[
                  const SizedBox(width: 10),
                  Flexible(
                    child: Text(
                      rangeLabel(store.from, store.to),
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13.5, color: t.textMuted),
                    ),
                  ),
                ],
              ],
            ),
            actions: [
              IconButton(
                onPressed: _openSearch,
                icon: const Icon(Icons.search),
                tooltip: 'Kartlarda ara',
              ),
              if (_isDesktopLayout && wide)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: OutlinedButton.icon(
                    onPressed: () => setState(() => _fastNav = !_fastNav),
                    icon: Icon(
                      Icons.bolt,
                      size: 17,
                      color: _fastNav ? t.accent : t.textMuted,
                    ),
                    label: const Text('Hızlı gezme'),
                    // Açıkken tekerlek gün geçirir, sürükleme eşiği kısalır.
                    style: OutlinedButton.styleFrom(
                      foregroundColor: _fastNav ? t.accent : t.text,
                      side: BorderSide(
                        color: _fastNav ? t.accent : t.borderStrong,
                      ),
                      backgroundColor: _fastNav
                          ? t.accent.withValues(alpha: .14)
                          : Colors.transparent,
                    ),
                  ),
                ),
              PopupMenuButton<String>(
                icon: const Icon(Icons.more_horiz),
                color: t.surface,
                onSelected: (value) async {
                  if (value == 'refresh') await store.loadRange();
                  if (value == 'sync') {
                    await store.syncNow();
                    await store.loadRange();
                  }
                  if (value == 'logout') await store.logout();
                },
                itemBuilder: (_) => const [
                  PopupMenuItem(value: 'refresh', child: Text('Yenile')),
                  PopupMenuItem(value: 'sync', child: Text('Senkronize et')),
                  PopupMenuItem(value: 'logout', child: Text('Çıkış')),
                ],
              ),
              const SizedBox(width: 6),
            ],
          ),
          body: Column(
            children: [
              if (MediaQuery.sizeOf(context).width < 1101)
                _DayStrip(
                  days: days,
                  activeIndex: _index,
                  onSelect: (i) {
                    setState(() => _index = i);
                    if (!wide) {
                      _pages.animateToPage(
                        i,
                        duration: const Duration(milliseconds: 220),
                        curve: Curves.easeOut,
                      );
                    }
                  },
                  // Kartı şeritteki bir güne bırakmak onu o güne taşır.
                  onDropOnDay: (i, card) {
                    final target = store.cardsOf(days[i]);
                    _move(
                      card,
                      days[i],
                      target.isEmpty ? null : target.last.id,
                      null,
                    );
                  },
                ),
              if (store.error != null)
                Semantics(
                  liveRegion: true,
                  child: Container(
                    width: double.infinity,
                    color: t.danger.withValues(alpha: .12),
                    padding: const EdgeInsets.symmetric(
                      horizontal: 14,
                      vertical: 8,
                    ),
                    child: Text(
                      store.error!,
                      style: TextStyle(fontSize: 12.5, color: t.danger),
                    ),
                  ),
                ),
              // Ağ yokken yerel kopyayla çalışıldığını açıkça söyle.
              if (store.offline)
                Container(
                  width: double.infinity,
                  color: t.cardColor('amber').withValues(alpha: .14),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.cloud_off,
                        size: 15,
                        color: t.cardColor('amber'),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          store.pendingWrites > 0
                              ? 'Çevrimdışı · ${store.pendingWrites} değişiklik bağlantı gelince gönderilecek'
                              : 'Çevrimdışı · yerel kopya gösteriliyor',
                          style: TextStyle(
                            fontSize: 12.5,
                            color: t.cardColor('amber'),
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () =>
                            store.syncNow().then((_) => store.loadRange()),
                        child: const Text('Yeniden dene'),
                      ),
                    ],
                  ),
                ),
              Expanded(
                child: wide
                    ? LayoutBuilder(
                        builder: (context, constraints) {
                          // Ekrana kaç gün sığıyorsa o kadarını göster.
                          // Web'deki hesabın aynısı: min kolon 190 + 12 boşluk.
                          const minColumn = 190.0, gap = 12.0;
                          final fits =
                              ((constraints.maxWidth + gap) / (minColumn + gap))
                                  .floor()
                                  .clamp(1, 7);
                          if (fits != store.visibleDays) {
                            WidgetsBinding.instance.addPostFrameCallback(
                              (_) => store.setVisibleDays(fits),
                            );
                          }
                          return Stack(
                            children: [
                              // Fareyle sürükleyerek gün gezme: kart sürüklenmiyorsa devrede.
                              Listener(
                                // Kolonların altındaki boşlukta da olay alsın:
                                // varsayılan davranış yalnız çocukların olduğu yeri dinler.
                                behavior: HitTestBehavior.translucent,
                                onPointerSignal: _onWheel,
                                onPointerDown: (_) => _panTotal = 0,
                                onPointerMove: _onPointerPan,
                                onPointerUp: (_) {
                                  if (_panDir != 0) setState(() => _panDir = 0);
                                  _panTotal = 0;
                                },
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    for (final day in days)
                                      Expanded(
                                        child: _DayColumn(
                                          store: store,
                                          day: day,
                                          onAdd: _openEditor,
                                          onCard: _cardActions,
                                          onMove: _move,
                                          dragEnabled: !_fastNav,
                                          onDragState: (active) =>
                                              _cardDragging = active,
                                        ),
                                      ),
                                  ],
                                ),
                              ),
                              // Kart sürüklerken kenara götürünce gün penceresi kayar,
                              // böylece ekranda görünmeyen güne de bırakabilirsin.
                              Positioned(
                                left: 0,
                                top: 0,
                                bottom: 0,
                                child: _EdgeFlipper(
                                  direction: -1,
                                  onFlip: (d) => store.shift(d),
                                ),
                              ),
                              Positioned(
                                right: 0,
                                top: 0,
                                bottom: 0,
                                child: _EdgeFlipper(
                                  direction: 1,
                                  onFlip: (d) => store.shift(d),
                                ),
                              ),
                              if (_panDir != 0)
                                Positioned(
                                  top: 0,
                                  bottom: 0,
                                  right: _panDir > 0 ? 18 : null,
                                  left: _panDir < 0 ? 18 : null,
                                  child: Center(
                                    child: _PanHint(forward: _panDir > 0),
                                  ),
                                ),
                            ],
                          );
                        },
                      )
                    : Stack(
                        children: [
                          PageView.builder(
                            controller: _pages,
                            itemCount: days.length,
                            onPageChanged: _onPageChanged,
                            itemBuilder: (_, i) => _DayColumn(
                              store: store,
                              day: days[i],
                              onAdd: _openEditor,
                              onCard: _cardActions,
                              onMove: _move,
                            ),
                          ),
                          // Sürüklenen kart kenarda beklerse gün değişir.
                          Positioned(
                            left: 0,
                            top: 0,
                            bottom: 0,
                            child: _EdgeFlipper(
                              direction: -1,
                              onFlip: _flipPage,
                              interval: const Duration(milliseconds: 585),
                            ),
                          ),
                          Positioned(
                            right: 0,
                            top: 0,
                            bottom: 0,
                            child: _EdgeFlipper(
                              direction: 1,
                              onFlip: _flipPage,
                              interval: const Duration(milliseconds: 585),
                            ),
                          ),
                        ],
                      ),
              ),
            ],
          ),
          floatingActionButton: FloatingActionButton(
            onPressed: () =>
                _openEditor(day: days[_index.clamp(0, days.length - 1)]),
            tooltip: 'Bu güne kart ekle',
            backgroundColor: t.accent,
            foregroundColor: t.accentFg,
            child: const Icon(Icons.add),
          ),
        );
      },
    );
  }

  /// Sayfa uçlarına gelindiğinde 7 günlük pencere kayar; böylece hafta sınırına
  /// takılmadan sonsuza kadar sağa/sola kaydırabilirsin.
  bool _shifting = false;

  Future<void> _onPageChanged(int i) async {
    setState(() => _index = i);
    if (_shifting) return;

    final last = store.days.length - 1;
    if (i == 0 && store.days.first.compareTo(store.minDay) > 0) {
      _shifting = true;
      store.shift(-1); // gün geriye: görünen gün 0 -> 1 olur
      await Future<void>.delayed(const Duration(milliseconds: 16));
      if (mounted) {
        _pages.jumpToPage(1);
        setState(() => _index = 1);
      }
      _shifting = false;
    } else if (i == last && store.days.last.compareTo(store.maxDay) < 0) {
      _shifting = true;
      store.shift(1); // gün ileriye: görünen gün 6 -> 5 olur
      await Future<void>.delayed(const Duration(milliseconds: 16));
      if (mounted) {
        _pages.jumpToPage(last - 1);
        setState(() => _index = last - 1);
      }
      _shifting = false;
    }
  }

  /// Sürükleme sırasında kenarda bekleyince önceki/sonraki güne geçer.
  void _flipPage(int direction) {
    final next = (_index + direction).clamp(0, store.days.length - 1);
    if (next == _index) return;
    setState(() => _index = next);
    _pages.animateToPage(
      next,
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOut,
    );
  }

  /// "Hızlı gezme" açıkken fare tekerleği gün geçirir (bir tık = bir gün).
  double _wheelTotal = 0;

  void _onWheel(PointerSignalEvent event) {
    if (!_fastNav || event is! PointerScrollEvent) return;
    _wheelTotal += event.scrollDelta.dy;
    const step = 50.0;
    while (_wheelTotal.abs() >= step) {
      store.shift(_wheelTotal > 0 ? 1 : -1);
      _wheelTotal -= _wheelTotal.sign * step;
    }
  }

  /// Fareyle sürükleyerek gün gezme. Sağa çekmek ileri (yeşil), sola geri (kırmızı).
  /// Hızlı gezme açıkken eşik küçülür; kart sürüklenirken devreye girmez.
  void _onPointerPan(PointerMoveEvent event) {
    if (_cardDragging) return;
    if (event.delta.dx == 0) return;

    _panTotal += event.delta.dx;
    if (_panTotal.abs() < 10) return; // küçük titremeler gezinme sayılmasın

    final dir = _panTotal > 0 ? 1 : -1;
    if (_panDir != dir) setState(() => _panDir = dir);

    final step = _fastNav ? 38.0 : 95.0;
    while (_panTotal.abs() >= step) {
      store.shift(_panTotal > 0 ? 1 : -1);
      _panTotal -= _panTotal.sign * step;
    }
  }

  void _move(PlannerCard card, String day, String? beforeId, String? afterId) {
    // Aynı yere bırakıldıysa sunucuyu meşgul etme.
    if (card.id == beforeId || card.id == afterId) return;
    store.moveCard(card, day: day, beforeId: beforeId, afterId: afterId);
  }

  void _shift(int delta) {
    store.shift(delta);
    if (_pages.hasClients) _pages.jumpToPage(0);
    setState(() => _index = 0);
  }
}

class _DayColumn extends StatelessWidget {
  const _DayColumn({
    required this.store,
    required this.day,
    required this.onAdd,
    required this.onCard,
    required this.onMove,
    this.dragEnabled = true,
    this.onDragState,
  });

  final PlannerStore store;
  final String day;
  final void Function({PlannerCard? card, required String day}) onAdd;
  final void Function(PlannerCard card) onCard;

  /// (kart, hedef gün, üstündeki kart, altındaki kart)
  final void Function(
    PlannerCard card,
    String day,
    String? beforeId,
    String? afterId,
  )
  onMove;

  /// Hızlı gezme açıkken kart sürüklemesi kapanır, pano kayar.
  final bool dragEnabled;

  /// Kart sürüklemesi başlayıp bitince haber verir (pano kaymasın diye).
  final void Function(bool active)? onDragState;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final cards = store.cardsOf(day);
    final isToday = day == todayKey();
    final isPast = day.compareTo(todayKey()) < 0;

    return Container(
      margin: const EdgeInsets.fromLTRB(6, 12, 6, 12),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: isToday
            ? Color.alphaBlend(t.accent.withValues(alpha: .04), t.surface)
            : t.surface,
        border: Border.all(
          color: isToday ? t.accent.withValues(alpha: .45) : t.border,
        ),
        borderRadius: BorderRadius.circular(R.lg),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 2, 4, 8),
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    dayName(day),
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13.5,
                      fontWeight: FontWeight.w600,
                      letterSpacing: -.13,
                      color: isToday
                          ? t.accent
                          : isPast
                          ? t.textMuted
                          : t.text,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    shortDate(day),
                    overflow: TextOverflow.ellipsis,
                    softWrap: false,
                    style: TextStyle(fontSize: 12.5, color: t.textFaint),
                  ),
                ),
                if (isToday) ...[
                  const SizedBox(width: 6),
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: t.accent,
                      shape: BoxShape.circle,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              padding: EdgeInsets.zero,
              children: [
                for (var i = 0; i < cards.length; i++) ...[
                  // Bu kartın ÜSTÜNE bırakma bölgesi
                  DropSlot(
                    onDrop: (dragged) => onMove(
                      dragged,
                      day,
                      i > 0 ? cards[i - 1].id : null,
                      cards[i].id,
                    ),
                  ),
                  DraggableCard(
                    card: cards[i],
                    imageHeaders: store.api.imageHeaders,
                    imageUrl: store.api.imageUrl,
                    enabled: dragEnabled,
                    onDragState: onDragState,
                    onTap: () => onCard(cards[i]),
                    onEdit: () => onAdd(card: cards[i], day: cards[i].day),
                    onToggleChecklist: (itemId) =>
                        store.toggleChecklistItem(cards[i], itemId),
                  ),
                ],
                // Listenin sonu: buraya bırakılan kart en alta gider
                DropSlot(
                  tall: true,
                  onDrop: (dragged) => onMove(
                    dragged,
                    day,
                    cards.isEmpty ? null : cards.last.id,
                    null,
                  ),
                ),
                _AddButton(onTap: () => onAdd(day: day)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.onTap});
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(R.md),
      child: Container(
        height: 40,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          border: Border.all(color: t.borderStrong, style: BorderStyle.solid),
          borderRadius: BorderRadius.circular(R.md),
        ),
        child: Text(
          '+ Ekle',
          style: TextStyle(fontSize: 12.5, color: t.textMuted),
        ),
      ),
    );
  }
}

/// Sürüklerken kenarda beliren yön göstergesi.
class _PanHint extends StatelessWidget {
  const _PanHint({required this.forward});
  final bool forward;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    final color = forward ? t.cardColor('green') : t.danger;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Color.alphaBlend(color.withValues(alpha: .18), t.surface),
        border: Border.all(color: color),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        forward ? '▶ ileri' : '◀ geri',
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}

class _DayStrip extends StatelessWidget {
  const _DayStrip({
    required this.days,
    required this.activeIndex,
    required this.onSelect,
    required this.onDropOnDay,
  });
  final List<String> days;
  final int activeIndex;
  final ValueChanged<int> onSelect;
  final void Function(int index, PlannerCard card) onDropOnDay;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return Container(
      color: t.surface,
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
      child: Row(
        children: [
          for (var i = 0; i < days.length; i++) ...[
            if (i > 0) const SizedBox(width: 7),
            Expanded(
              child: DragTarget<PlannerCard>(
                onWillAcceptWithDetails: (_) => true,
                onAcceptWithDetails: (details) => onDropOnDay(i, details.data),
                builder: (context, candidate, _) {
                  final hovering = candidate.isNotEmpty;
                  return Semantics(
                    button: true,
                    selected: i == activeIndex,
                    label: '${dayNameShort(days[i])}, ${dayNumber(days[i])}',
                    child: InkWell(
                      onTap: () => onSelect(i),
                      borderRadius: BorderRadius.circular(R.md),
                      child: Container(
                        height: 52,
                        decoration: BoxDecoration(
                          color: hovering
                              ? Color.alphaBlend(
                                  t.accent.withValues(alpha: .3),
                                  t.surface,
                                )
                              : i == activeIndex
                              ? Color.alphaBlend(
                                  t.accent.withValues(alpha: .15),
                                  t.surface,
                                )
                              : t.surface2,
                          border: Border.all(
                            color: i == activeIndex || hovering
                                ? t.accent
                                : t.border,
                            width: hovering ? 2 : 1,
                          ),
                          borderRadius: BorderRadius.circular(R.md),
                        ),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              dayNameShort(days[i]).toUpperCase(),
                              style: TextStyle(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w600,
                                letterSpacing: .3,
                                color: i == activeIndex
                                    ? t.accent
                                    : t.textMuted,
                              ),
                            ),
                            Text(
                              '${dayNumber(days[i])}',
                              style: TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -.3,
                                color: i == activeIndex ? t.accent : t.text,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Ekranın sol/sağ kenarındaki ince bölge: sürüklenen kart burada beklerse
/// sayfa gün gün ilerler, böylece telefonda da başka güne taşınabilir.
class _EdgeFlipper extends StatefulWidget {
  const _EdgeFlipper({
    required this.direction,
    required this.onFlip,
    this.interval = const Duration(milliseconds: 650),
  });

  /// -1 önceki gün, +1 sonraki gün
  final int direction;
  final void Function(int direction) onFlip;
  final Duration interval;

  @override
  State<_EdgeFlipper> createState() => _EdgeFlipperState();
}

class _EdgeFlipperState extends State<_EdgeFlipper> {
  Timer? _timer;

  void _start() {
    if (_timer != null) return;
    _timer = Timer.periodic(
      widget.interval,
      (_) => widget.onFlip(widget.direction),
    );
    setState(() {});
  }

  void _stop() {
    if (_timer == null) return;
    _timer!.cancel();
    _timer = null;
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return DragTarget<PlannerCard>(
      onWillAcceptWithDetails: (_) {
        _start();
        return false; // kartı yutma; yalnızca sayfayı çevir
      },
      onLeave: (_) => _stop(),
      builder: (context, candidate, _) => SizedBox(
        width: 62,
        child: _timer == null
            ? null
            : Center(
                child: Container(
                  width: 46,
                  height: 72,
                  decoration: BoxDecoration(
                    color: t.accent.withValues(alpha: .18),
                    border: Border.all(color: t.accent, width: 1.5),
                    borderRadius: BorderRadius.circular(R.md),
                  ),
                  child: Icon(
                    widget.direction < 0
                        ? Icons.chevron_left
                        : Icons.chevron_right,
                    color: t.accent,
                    size: 30,
                  ),
                ),
              ),
      ),
    );
  }
}
