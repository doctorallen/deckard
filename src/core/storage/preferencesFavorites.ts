import type { PreferencesRepository } from './preferencesRepository';
import { toggled } from './preferencesSchema';

/**
 * The tags and entities a reader marked as favorites, and the order they
 * dragged tags and entities into. Both are choices made on purpose, so
 * nothing but these calls changes them; pruning never does.
 */
export class FavoritesService {
  /** Reads the blob from `repository` and keeps each change through it. */
  public constructor(private readonly repository: PreferencesRepository) {}

  /**
   * Toggles favorites without coupling tag presentation to note content.
   */
  public async toggleFavorite(tagKey: string): Promise<void> {
    await this.repository.update({ favoriteTags: toggled(this.repository.current.favoriteTags, tagKey) });
  }

  /** Marks an entity as a favorite, or stops marking it. */
  public async toggleFavoriteEntity(entityKey: string): Promise<void> {
    await this.repository.update({
      favoriteEntities: toggled(this.repository.current.favoriteEntities, entityKey),
    });
  }

  /**
   * Stores custom tag order as a de-duplicated sequence of canonical keys.
   */
  public async setTagAccessOrder(tagAccessOrder: string[]): Promise<void> {
    await this.repository.update({ tagAccessOrder: [...new Set(tagAccessOrder)] });
  }

  /** Stores the custom entity order, each key once, as the tag order is. */
  public async setEntityAccessOrder(
    entityAccessOrder: string[],
  ): Promise<void> {
    await this.repository.update({ entityAccessOrder: [...new Set(entityAccessOrder)] });
  }

  /**
   * Applies a drag reorder and favorite membership atomically.
   *
   * One persistence event keeps the dashboard from rendering an intermediate
   * order with stale favorite grouping.
   */
  public async setTagAccessOrderAndFavorites(
    tagAccessOrder: string[],
    favoriteTags: string[],
  ): Promise<void> {
    await this.repository.update({
      tagAccessOrder: [...new Set(tagAccessOrder)],
      favoriteTags: [...new Set(favoriteTags)],
    });
  }
}
