import { cardTemplateDto } from './dto.ts';
import { newId } from './ids.ts';
import { applyReminders } from './reminders.ts';
import type { Repo } from './repo.ts';
import type { CardImageRow, UserRow } from './types.ts';

/**
 * Şablona hâlâ bağlı kartları şablonun güncel hâline getirir.
 * Gün, deadline, sıra ve kart durumu karta özeldir. Kart üzerinde yapılan herhangi
 * bir kullanıcı işlemi template_id'yi daha önce temizlediği için burada yalnızca
 * gerçekten hiç değiştirilmemiş bağlı kartlar kalır.
 */
export function syncLinkedCards(
  store: Repo,
  templateId: string,
  user: UserRow,
): CardImageRow[] {
  const template = store.templates.get(templateId);
  if (!template) return [];
  const dto = cardTemplateDto(template);
  const templateImages = store.templates.images(templateId);
  const removedImages: CardImageRow[] = [];

  for (const card of store.cards.linkedToTemplate(templateId)) {
    store.cards.update(
      card.id,
      {
        title: dto.title,
        note: dto.note,
        startTime: dto.startTime,
        endTime: dto.endTime,
        color: dto.color,
        priority: dto.priority,
        tags: dto.tags,
        checklist: dto.checklist.map((item) => ({ id: newId(), text: item.text, done: false })),
      },
      { preserveTemplate: true },
    );
    const updated = store.cards.get(card.id)!;
    applyReminders(store, updated, user, dto.reminders);
    removedImages.push(...store.images.replaceForCard(card.id, templateImages));
  }

  return store.images.unreferenced(removedImages);
}
