import { useBreakpoint } from '@healthy360/design-system';
import { Children } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The design's `repeat(3, minmax(0, 1fr))` card row, over however many plans the catalogue holds:
 * three equal columns from `lg`, two on a tablet, one on a phone.
 *
 * Rows are built in JavaScript rather than with a wrapping flex row and a width guess, because a
 * column is a structural fact here — `useBreakpoint` is how a structural branch is expressed — and
 * equal `flex-1` cells (padded out with empty ones in a short last row) are exactly the design's
 * fractions at any content width, on native as well as on the web.
 */
export function PlanGrid({
    children,
    testID,
}: {
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}) {
    const { atLeast } = useBreakpoint();
    const columns = atLeast('lg') ? 3 : atLeast('md') ? 2 : 1;
    const cells = Children.toArray(children);
    const rows: ReactNode[][] = [];
    for (let index = 0; index < cells.length; index += columns) {
        rows.push(cells.slice(index, index + columns));
    }

    return (
        <View testID={testID} className="flex-col gap-4">
            {rows.map((row, rowIndex) => (
                <View key={rowIndex} className="flex-row items-stretch gap-4">
                    {row}
                    {Array.from({ length: columns - row.length }, (_, filler) => (
                        <View key={`filler-${String(filler)}`} className="min-w-0 flex-1" />
                    ))}
                </View>
            ))}
        </View>
    );
}

export function PlanGridItem({ children }: { readonly children: ReactNode }) {
    return <View className="min-w-0 flex-1 flex-col">{children}</View>;
}
