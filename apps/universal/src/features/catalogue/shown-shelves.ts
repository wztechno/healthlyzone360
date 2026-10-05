/**
 * The shelves the customer menu shows for now — Frozen alone.
 *
 * A temporary narrowing, not a removal: Discover and `/meals` list only these shelves and their
 * items, and every other shelf is hidden rather than deleted. Widen {@link SHOWN_SHELVES} (or empty
 * it) to bring them back; nothing else needs to change.
 *
 * Frozen items are catalogue `product`s on the `frozen` shelf, not `meal`s, so a listing restricted
 * to these shelves has to ask for products as well.
 */
export const SHOWN_SHELVES: readonly string[] = ['frozen'];

type ItemType = 'meal' | 'product' | 'sauce' | 'dressing';

/** The item types a narrowed listing asks for. */
const SHOWN_ITEM_TYPES: readonly ItemType[] = ['meal', 'product'];

export interface ShelfNarrowing {
    /** `true` while any shelf is hidden. */
    readonly narrowed: boolean;
    /** `true` when nothing is narrowed, or the shelf is one of the shown ones. */
    readonly isShownShelf: (code: string) => boolean;
    /**
     * The `category_slug` a listing sends: the shelf somebody picked when it is shown, otherwise
     * the only shown shelf. The API takes one slug, so with several shown shelves and none picked
     * the listing goes unfiltered by shelf.
     */
    readonly shownCategory: (picked?: string) => string | undefined;
    /** The item types a listing asks for: meals and products while narrowed, else `fallback`. */
    readonly shownItemTypes: (fallback: readonly ItemType[]) => readonly ItemType[];
}

/** The narrowing for a list of shown shelves; an empty list narrows nothing. */
export function shelfNarrowing(shelves: readonly string[]): ShelfNarrowing {
    const isShownShelf = (code: string) => shelves.length === 0 || shelves.includes(code);
    return {
        narrowed: shelves.length > 0,
        isShownShelf,
        shownCategory: (picked) => {
            if (picked !== undefined && isShownShelf(picked)) return picked;
            return shelves.length === 1 ? shelves[0] : undefined;
        },
        shownItemTypes: (fallback) => (shelves.length === 0 ? fallback : SHOWN_ITEM_TYPES),
    };
}

export const { narrowed, isShownShelf, shownCategory, shownItemTypes } =
    shelfNarrowing(SHOWN_SHELVES);
