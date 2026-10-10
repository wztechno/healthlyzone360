import { cx } from '@healthy360/design-system';
import { View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';

/**
 * The small square photograph the HealthZone `track` and `account` screens put beside an order line.
 *
 * An order line carries the meal's **name** and nothing that identifies it in the catalogue — no
 * meal id, no image id (`PlacedOrderLine`, `GuestOrderLine`). The bundled photographs are keyed by
 * the meal's slug, which the server derives from the name, so the name is slugged the same way and
 * offered to {@link EntityImage} as a `meal-…` id. A line whose slug matches a meal's own photograph
 * shows it; anything else — a renamed meal, a slug that differs from its name — falls back to the
 * generated pattern seeded by the name, which is the app's ordinary "no photograph" placeholder.
 * Never another meal's picture: the lookup is by this meal's own slug or not at all.
 */

/** `Steak & Chimichurri Plate` → `steak-chimichurri-plate`, the server's slug rule. */
export function slugForName(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export interface OrderLineThumbProps {
    readonly name: string;
    /** The frame's size and corner, e.g. `h-[46px] w-[46px] rounded`. */
    readonly className: string;
    readonly testID?: string | undefined;
}

export function OrderLineThumb({ name, className, testID }: OrderLineThumbProps) {
    const slug = slugForName(name);
    return (
        <View testID={testID} className={cx('shrink-0 overflow-hidden', className)}>
            <EntityImage
                assetId={slug === '' ? undefined : `meal-${slug}`}
                variant="card"
                seed={name}
                label={name}
                aspect="square"
                decorative
                flush
            />
        </View>
    );
}
