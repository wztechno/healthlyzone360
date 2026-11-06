import { Skeleton, useBreakpoint } from '@healthy360/design-system';
import type { SkeletonProps } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The shop's loading shapes (Shop · States, Menu pin 11). One look for all of them, as the board
 * draws it: blocks in the hairline colour on a raised card with a 22px corner, 8px-round lines,
 * 12px-round tiles, round buttons, one shimmer sweeping across. Each shape outlines what lands in
 * its place — a dish card, a plan card, a kitchen card, a list of rows, a price summary, a page —
 * so nothing reflows when the real content arrives.
 *
 * The wrapper carries `aria-busy`; every block is `aria-hidden` (see {@link Skeleton}).
 */

type BoneProps = Omit<SkeletonProps, 'variant' | 'tone'>;

/** One block in the shop's look. */
export function Bone({ rounded = 'base', ...rest }: BoneProps) {
    return <Skeleton {...rest} rounded={rounded} tone="line" variant="shimmer" />;
}

const FRAME = 'overflow-hidden rounded-[22px] border border-stroke-subtle bg-surface-raised';

function skeletonID(testID: string, index: number): string {
    return `${testID.replace(/-loading$/, '')}-skeleton-${String(index + 1)}`;
}

/** Splits `count` items into rows of the grid's column count, padding the last row. */
function useGrid(count: number, wideColumns: number) {
    const { atLeast } = useBreakpoint();
    const columns = atLeast('xl')
        ? wideColumns
        : atLeast('lg')
          ? Math.min(3, wideColumns)
          : atLeast('sm')
            ? 2
            : 1;
    const rows: number[][] = [];
    for (let index = 0; index < count; index += columns) {
        rows.push(Array.from({ length: Math.min(columns, count - index) }, (_, k) => index + k));
    }
    return { columns, rows };
}

function Grid({
    count,
    wideColumns,
    testID,
    renderItem,
}: {
    readonly count: number;
    readonly wideColumns: number;
    readonly testID: string;
    readonly renderItem: (index: number) => ReactNode;
}) {
    const { columns, rows } = useGrid(count, wideColumns);
    return (
        <View testID={testID} aria-busy className="flex-col gap-4">
            {rows.map((row) => (
                <View key={row[0]} className="flex-row gap-4">
                    {row.map((index) => (
                        <View key={index} aria-hidden className={`min-w-0 flex-1 ${FRAME}`}>
                            {renderItem(index)}
                        </View>
                    ))}
                    {Array.from({ length: columns - row.length }, (_, k) => (
                        <View key={`gap-${String(k)}`} className="min-w-0 flex-1" />
                    ))}
                </View>
            ))}
        </View>
    );
}

/** Dish cards: the photo, two lines, the four nutrient cells and the price row. */
export function ShopCardSkeletons({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    return (
        <Grid
            count={count}
            wideColumns={4}
            testID={testID}
            renderItem={(index) => (
                <>
                    <Bone
                        testID={skeletonID(testID, index)}
                        heightClassName="h-40"
                        rounded="none"
                    />
                    <View className="flex-col gap-2.5 p-4">
                        <Bone heightClassName="h-3.5" widthClassName="w-[70%]" />
                        <Bone heightClassName="h-3.5" widthClassName="w-[45%]" />
                        <View className="flex-row gap-1.5">
                            {[0, 1, 2, 3].map((cell) => (
                                <View key={cell} className="flex-1">
                                    <Bone heightClassName="h-10" rounded="lg" />
                                </View>
                            ))}
                        </View>
                        <View className="mt-1.5 flex-row items-center justify-between">
                            <Bone heightClassName="h-[18px]" widthClassName="w-16" />
                            <Bone heightClassName="h-10" widthClassName="w-10" rounded="full" />
                        </View>
                    </View>
                </>
            )}
        />
    );
}

/** Plan cards: the tinted head with name, chip and price, the week, the three figures, the actions. */
export function ShopPlanSkeletons({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    return (
        <Grid
            count={count}
            wideColumns={3}
            testID={testID}
            renderItem={(index) => (
                <>
                    <View
                        testID={skeletonID(testID, index)}
                        className="flex-col gap-2.5 bg-surface-sunken px-[18px] pb-4 pt-[18px]"
                    >
                        <Bone heightClassName="h-5" widthClassName="w-[60%]" />
                        <Bone heightClassName="h-6" widthClassName="w-24" rounded="full" />
                        <Bone heightClassName="h-7" widthClassName="w-28" />
                    </View>
                    <View className="flex-col gap-[11px] px-[18px] pb-4 pt-3.5">
                        <View className="flex-row gap-[5px]">
                            {[0, 1, 2, 3, 4, 5, 6].map((day) => (
                                <View key={day} className="flex-1">
                                    <Bone heightClassName="h-9" rounded="lg" />
                                </View>
                            ))}
                        </View>
                        <View className="flex-row gap-1.5">
                            {[0, 1, 2].map((cell) => (
                                <View key={cell} className="flex-1">
                                    <Bone heightClassName="h-12" rounded="lg" />
                                </View>
                            ))}
                        </View>
                        <Bone heightClassName="h-3.5" widthClassName="w-[80%]" />
                        <View className="mt-1 flex-row gap-2">
                            <Bone heightClassName="h-11" rounded="full" className="flex-1" />
                            <Bone heightClassName="h-11" widthClassName="w-11" rounded="full" />
                        </View>
                    </View>
                </>
            )}
        />
    );
}

/** Kitchen cards: the cover, the badge riding its edge, the name, two lines and the fact chips. */
export function ShopKitchenSkeletons({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    return (
        <Grid
            count={count}
            wideColumns={3}
            testID={testID}
            renderItem={(index) => (
                <>
                    <Bone
                        testID={skeletonID(testID, index)}
                        heightClassName="h-36"
                        rounded="none"
                    />
                    <View className="flex-col gap-2.5 px-4 pb-4">
                        <View className="-mt-6 h-12 w-12 rounded-2xl border-4 border-surface-raised bg-surface-raised">
                            <Bone heightClassName="h-full" rounded="lg" />
                        </View>
                        <Bone heightClassName="h-4" widthClassName="w-[55%]" />
                        <Bone heightClassName="h-3.5" widthClassName="w-[80%]" />
                        <View className="mt-1 flex-row gap-1.5">
                            {['w-20', 'w-16', 'w-24'].map((width) => (
                                <Bone
                                    key={width}
                                    heightClassName="h-7"
                                    widthClassName={width}
                                    rounded="full"
                                />
                            ))}
                        </View>
                    </View>
                </>
            )}
        />
    );
}

/** A list: one card of rows under hairlines — a tile, two lines and a trailing figure each. */
export function ShopRowSkeletons({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    return (
        <View testID={testID} aria-busy className={FRAME}>
            {Array.from({ length: count }, (_, index) => (
                <View
                    key={index}
                    aria-hidden
                    className={`flex-row items-center gap-3.5 px-4 py-3.5${
                        index === 0 ? '' : ' border-t border-stroke-subtle'
                    }`}
                >
                    <Bone
                        testID={skeletonID(testID, index)}
                        heightClassName="h-12"
                        widthClassName="w-12"
                        rounded="lg"
                    />
                    <View className="min-w-0 flex-1 gap-2">
                        <Bone
                            heightClassName="h-3.5"
                            widthClassName={index % 2 === 0 ? 'w-[55%]' : 'w-[45%]'}
                        />
                        <Bone heightClassName="h-3" widthClassName="w-[30%]" />
                    </View>
                    <Bone heightClassName="h-[18px]" widthClassName="w-16" />
                </View>
            ))}
        </View>
    );
}

/** A price summary: label and amount lines, then the total under a hairline. */
export function ShopLinesSkeleton({ testID }: { readonly testID: string }) {
    return (
        <View testID={testID} aria-busy className="flex-col gap-3.5 py-1">
            {[0, 1, 2].map((index) => (
                <View
                    key={index}
                    testID={skeletonID(testID, index)}
                    className="flex-row items-center justify-between gap-4"
                >
                    <Bone
                        heightClassName="h-3.5"
                        widthClassName={index === 1 ? 'w-2/5' : 'w-1/3'}
                    />
                    <Bone heightClassName="h-3.5" widthClassName="w-14" />
                </View>
            ))}
            <View className="flex-row items-center justify-between gap-4 border-t border-stroke-subtle pt-3.5">
                <Bone heightClassName="h-4" widthClassName="w-1/4" />
                <Bone heightClassName="h-6" widthClassName="w-20" />
            </View>
        </View>
    );
}

/** A detail page's opening: the photo beside the title, lines and chips, then a card of rows. */
export function ShopPageSkeleton({ testID }: { readonly testID: string }) {
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');
    return (
        <View testID={testID} aria-busy className="flex-col gap-6">
            <View className={wide ? 'flex-row gap-8' : 'flex-col gap-5'}>
                <View className={`overflow-hidden rounded-[22px] ${wide ? 'w-[46%]' : 'w-full'}`}>
                    <Bone
                        testID={skeletonID(testID, 0)}
                        heightClassName={wide ? 'h-80' : 'h-56'}
                        rounded="none"
                    />
                </View>
                <View className="min-w-0 flex-1 gap-3.5">
                    <Bone heightClassName="h-3" widthClassName="w-24" />
                    <Bone heightClassName="h-9" widthClassName="w-[70%]" />
                    <Bone heightClassName="h-3.5" widthClassName="w-[90%]" />
                    <Bone heightClassName="h-3.5" widthClassName="w-[65%]" />
                    <View className="mt-1 flex-row flex-wrap gap-2">
                        {['w-20', 'w-24', 'w-16'].map((width) => (
                            <Bone
                                key={width}
                                heightClassName="h-8"
                                widthClassName={width}
                                rounded="full"
                            />
                        ))}
                    </View>
                    <View className="mt-1 flex-row gap-2.5">
                        {[0, 1, 2].map((cell) => (
                            <View key={cell} className="flex-1">
                                <Bone heightClassName="h-16" rounded="lg" />
                            </View>
                        ))}
                    </View>
                    <View className="mt-2 flex-row items-center gap-3">
                        <Bone heightClassName="h-8" widthClassName="w-24" />
                        <Bone heightClassName="h-12" widthClassName="w-40" rounded="full" />
                    </View>
                </View>
            </View>
            <ShopRowSkeletons count={3} testID={`${testID}-rows`} />
        </View>
    );
}

/** A form: label and field pairs, then the save button. */
export function ShopFormSkeleton({ testID }: { readonly testID: string }) {
    return (
        <View testID={testID} aria-busy className={`flex-col gap-4 p-5 ${FRAME}`}>
            {[0, 1, 2].map((index) => (
                <View key={index} aria-hidden className="gap-2">
                    <Bone
                        testID={skeletonID(testID, index)}
                        heightClassName="h-3"
                        widthClassName="w-28"
                    />
                    <Bone heightClassName="h-12" rounded="lg" />
                </View>
            ))}
            <Bone heightClassName="h-11" widthClassName="w-36" rounded="full" />
        </View>
    );
}

/** A result in figures: a row of tiles, each a label over a big number. */
export function ShopFiguresSkeleton({
    count,
    testID,
}: {
    readonly count: number;
    readonly testID: string;
}) {
    return (
        <View testID={testID} aria-busy className="flex-row flex-wrap gap-2.5">
            {Array.from({ length: count }, (_, index) => (
                <View
                    key={index}
                    aria-hidden
                    className={`min-w-[140px] flex-1 gap-2.5 p-4 ${FRAME}`}
                >
                    <Bone
                        testID={skeletonID(testID, index)}
                        heightClassName="h-3"
                        widthClassName="w-20"
                    />
                    <Bone heightClassName="h-8" widthClassName="w-24" />
                </View>
            ))}
        </View>
    );
}
