import { Children, useState } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * HealthZone's `repeat(auto-fill, minmax(238px, 1fr))`, measured.
 *
 * The menu grid and "More from …" are drawn with that track list: as many 238px-or-wider columns
 * as fit, sharing the row evenly — three across the menu's 922px column at 1280, four across the
 * full 1184px measure. The marketplace `CardGrid` caps a cell at 284px instead, which is right for
 * its four-across shelves but leaves the menu's three columns 38px short of the edge.
 *
 * A wrapping flex row cannot express `auto-fill` on its own — the free space on a short last row
 * goes to whatever is on it, so a single trailing card would stretch across the whole width. So the
 * row measures itself, works out the column count the CSS would, and gives every cell that exact
 * width. Until the first layout pass (and in a test renderer, which has none) the cells fall back
 * to a 238px basis, which is the same arithmetic without the cap.
 */
const GAP = 16;

export interface MenuGridProps {
    readonly children: ReactNode;
    /** The track minimum. */
    readonly minCell?: number | undefined;
    readonly testID?: string | undefined;
}

export function MenuGrid({ children, minCell = 238, testID }: MenuGridProps) {
    const [width, setWidth] = useState<number | null>(null);

    const columns =
        width === null ? null : Math.max(1, Math.floor((width + GAP) / (minCell + GAP)));
    // Floored, because a cell a fraction of a pixel too wide wraps the last one onto a new row.
    const cell =
        width === null || columns === null
            ? null
            : Math.floor((width - (columns - 1) * GAP) / columns);

    return (
        <View
            testID={testID}
            className="flex-row flex-wrap gap-4"
            onLayout={(event) => {
                setWidth(event.nativeEvent.layout.width);
            }}
        >
            {Children.map(children, (child) => (
                <View
                    className={cell === null ? 'min-w-[238px] flex-1 basis-[238px]' : 'flex-col'}
                    style={cell === null ? undefined : { width: cell }}
                >
                    {child}
                </View>
            ))}
        </View>
    );
}
