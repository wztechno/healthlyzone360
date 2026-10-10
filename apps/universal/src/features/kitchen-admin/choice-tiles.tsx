import { Text, cx } from '@healthy360/design-system';
import { Pressable, View } from 'react-native';

/** One tile: what it is, and what choosing it will ask for or do. */
export interface ChoiceTile<Value extends string> {
    readonly value: Value;
    readonly title: string;
    readonly body: string;
}

export interface ChoiceTilesProps<Value extends string> {
    /** The group's accessible name — the section it answers. */
    readonly label: string;
    readonly tiles: readonly ChoiceTile<Value>[];
    readonly value: Value;
    readonly onChange: (value: Value) => void;
    /** The group; each tile is `{testID}-{value}`. */
    readonly testID: string;
}

/**
 * A one-of choice drawn as tiles side by side — "What arrived", "Subject", "Start as".
 *
 * ```
 * ┌───────────────────────────────┐ ┌───────────────────────────────┐
 * │ (•) A market purchase          │ │ ( ) A delivery against an order │
 * │     Bought without an order…   │ │     Pick the supply order…      │
 * └───────────────────────────────┘ └───────────────────────────────┘
 * ```
 *
 * Tiles rather than a segmented control because each choice is made by what it will do, and a
 * segment has no room to say. Each tile is the radio itself rather than a row wrapping one, which
 * would be nested-interactive; a tile takes half the row down to 240px and then wraps.
 */
export function ChoiceTiles<Value extends string>({
    label,
    tiles,
    value,
    onChange,
    testID,
}: ChoiceTilesProps<Value>) {
    return (
        <View
            testID={testID}
            role="radiogroup"
            aria-label={label}
            className="flex-row flex-wrap gap-tight"
        >
            {tiles.map((tile) => {
                const on = value === tile.value;
                return (
                    <View key={tile.value} className="min-w-[240px] flex-1">
                        <Pressable
                            testID={`${testID}-${tile.value}`}
                            role="radio"
                            accessibilityRole="radio"
                            aria-checked={on}
                            accessibilityState={{ checked: on }}
                            aria-label={tile.title}
                            onPress={() => {
                                if (!on) onChange(tile.value);
                            }}
                            className={cx(
                                'flex-row items-start gap-2.5 rounded border p-snug',
                                /*
                                 * Chosen: the brand edge doubled by an inset ring, so the choice
                                 * reads at a glance without the border growing and the text inside
                                 * shifting by a pixel. Web only — native has no inset shadow, and
                                 * the fill already carries it there.
                                 */
                                on
                                    ? 'border-surface-brand bg-surface-brand-subtle web:shadow-[inset_0_0_0_1px_rgb(var(--h360-color-brand-surface))]'
                                    : 'border-stroke bg-surface-raised web:hover:border-surface-brand',
                            )}
                        >
                            <RadioMark on={on} />
                            {/* 13/18 over 12/18, 2px apart — the mark's 2px drop centres it on the title. */}
                            <View className="min-w-0 flex-1 flex-col gap-0.5">
                                <Text variant="strong">{tile.title}</Text>
                                <Text variant="body" tone="secondary">
                                    {tile.body}
                                </Text>
                            </View>
                        </Pressable>
                    </View>
                );
            })}
        </View>
    );
}

/**
 * The round mark of a single choice — the tiles' and any radio row's.
 *
 * 14px (`icon-sm` — the scale has no `3.5`) and `shrink-0`, or a row whose text wants the width
 * squeezes the circle into an oval.
 */
export function RadioMark({ on }: { readonly on: boolean }) {
    return (
        <View
            aria-hidden
            className={cx(
                'mt-0.5 h-icon-sm w-icon-sm shrink-0 items-center justify-center rounded-full border bg-surface-raised',
                on ? 'border-surface-brand' : 'border-stroke-strong',
            )}
        >
            {on ? <View className="h-1.5 w-1.5 shrink-0 rounded-full bg-surface-brand" /> : null}
        </View>
    );
}
