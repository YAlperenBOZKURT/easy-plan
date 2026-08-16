import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, TargetPlatform;
import 'package:flutter/material.dart';

import '../api/models.dart';
import '../theme.dart';
import 'card_tile.dart';

/// Sürüklenen kartın taşıdığı bilgi.
typedef CardDrag = PlannerCard;

bool get _isDesktop =>
    defaultTargetPlatform == TargetPlatform.windows ||
    defaultTargetPlatform == TargetPlatform.linux ||
    defaultTargetPlatform == TargetPlatform.macOS;

/// Kartı sürüklenebilir yapar.
///
/// Masaüstünde fareyle doğrudan çekilir; dokunmatikte basılı tutunca başlar —
/// aksi hâlde listeyi kaydırmak imkânsız olurdu.
class DraggableCard extends StatelessWidget {
  const DraggableCard({
    super.key,
    required this.card,
    required this.imageHeaders,
    required this.imageUrl,
    required this.onTap,
    required this.onEdit,
    required this.onToggleChecklist,
    this.enabled = true,
    this.onDragState,
  });

  final PlannerCard card;
  final Map<String, String> imageHeaders;
  final String Function(String) imageUrl;
  final VoidCallback onTap;
  final VoidCallback onEdit;
  final void Function(String itemId) onToggleChecklist;

  /// Hızlı gezme modunda sürükleme kapatılır; pano tek parça kayar.
  final bool enabled;

  /// Karta basılınca/bırakılınca haber verir: drag başlamadan önceki ilk büyük
  /// pointer hareketi de pano gezinmesi sanılmasın.
  final void Function(bool active)? onDragState;

  @override
  Widget build(BuildContext context) {
    final tile = CardTile(
      card: card,
      imageHeaders: imageHeaders,
      imageUrl: imageUrl,
      onTap: onTap,
      onLongPress: _isDesktop ? onEdit : null,
      onToggleChecklist: onToggleChecklist,
    );

    // Taşınan kopya yarı saydam: altındaki kolonlar ve kenar şeritleri görünsün.
    final feedback = Opacity(
      opacity: .68,
      child: Transform.rotate(
        angle: .024,
        child: Material(
          color: Colors.transparent,
          elevation: 12,
          borderRadius: BorderRadius.circular(R.md),
          child: SizedBox(
            width: 260,
            child: CardTile(
              card: card,
              imageHeaders: imageHeaders,
              imageUrl: imageUrl,
            ),
          ),
        ),
      ),
    );

    final placeholder = Opacity(opacity: .3, child: tile);

    if (!enabled) return tile;

    final draggable = _isDesktop
        ? Draggable<CardDrag>(
            data: card,
            feedback: feedback,
            childWhenDragging: placeholder,
            child: tile,
          )
        : LongPressDraggable<CardDrag>(
            data: card,
            delay: const Duration(milliseconds: 220),
            feedback: feedback,
            childWhenDragging: placeholder,
            child: tile,
          );

    return Listener(
      onPointerDown: (_) => onDragState?.call(true),
      onPointerUp: (_) => onDragState?.call(false),
      onPointerCancel: (_) => onDragState?.call(false),
      child: draggable,
    );
  }
}

/// Kartlar arasındaki bırakma bölgesi: buraya bırakılan kart tam bu sıraya girer.
class DropSlot extends StatelessWidget {
  const DropSlot({super.key, required this.onDrop, this.tall = false});

  /// Bırakılan kartı alır.
  final void Function(PlannerCard card) onDrop;

  /// Kolonun altındaki geniş boşluk için.
  final bool tall;

  @override
  Widget build(BuildContext context) {
    final t = context.tokens;
    return DragTarget<CardDrag>(
      onWillAcceptWithDetails: (_) => true,
      onAcceptWithDetails: (details) => onDrop(details.data),
      builder: (context, candidate, _) {
        final active = candidate.isNotEmpty;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 120),
          height: active ? 34 : (tall ? 48 : 10),
          margin: EdgeInsets.symmetric(vertical: active ? 4 : 0),
          decoration: active
              ? BoxDecoration(
                  color: t.accent.withValues(alpha: .12),
                  border: Border.all(color: t.accent, style: BorderStyle.solid),
                  borderRadius: BorderRadius.circular(R.sm),
                )
              : null,
          child: active
              ? Center(
                  child: Text(
                    'Buraya bırak',
                    style: TextStyle(
                      fontSize: 11.5,
                      color: t.accent,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                )
              : null,
        );
      },
    );
  }
}
