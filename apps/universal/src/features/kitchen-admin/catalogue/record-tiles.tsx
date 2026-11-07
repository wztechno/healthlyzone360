import { Icon, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useRecordSplit } from './record-popup.tsx';

/**
 * The tiles under a {@link RecordCanopy}: one subject each — allergens, prices, nutrition — with
 * its own glyph, so the page reads as a set of answers rather than a form laid flat.
 *
 * ```
 * ┌ [◈] Allergens & diets ─────── ● Contains ● May contain ○ Free from ┐ ┌ [◇] Prices ──── per kg ┐
 * │ …                                                                  │ │ …                      │
 * └────────────────────────────────────────────────────────────────────┘ └────────────────────────┘
 * ```
 *
 * A {@link RecordTileRow} lays its tiles side by side, each taking its `weight` of the row, where
 * the *page* has room for both — `RECORD_SPLIT_MIN` on a page, `RECORD_POPUP_SPLIT_MIN` in a pop-up — and
 * stacks them below that. Tiles stretch to the tallest in their row, so a row's floors line up.
 *
 * Tiles and their row are `z-auto`: an (i) inside one must open over the tile drawn after it.
 */

const SplitContext = createContext(false);

export interface RecordTileRowProps {
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}

export function RecordTileRow({ children, testID }: RecordTileRowProps) {
    const split = useRecordSplit();

    return (
        <SplitContext.Provider value={split}>
            <View
                testID={testID}
                className={
                    split ? 'z-auto flex-row items-stretch gap-base' : 'z-auto flex-col gap-base'
                }
            >
                {children}
            </View>
        </SplitContext.Provider>
    );
}

export type RecordTileTone = 'raised' | 'brand' | 'warning';

const TILE_TONE_CLASS: Readonly<Record<RecordTileTone, string>> = {
    raised: 'border-brand-100 bg-surface-raised',
    brand: 'border-brand-100 bg-surface-brand-subtle',
    warning: 'border-warning-border bg-warning-subtle',
};

export interface RecordTileProps {
    readonly icon: IconName;
    /** Translated. Omitted, the tile has no head — a table that names itself. */
    readonly title?: string | undefined;
    readonly tone?: RecordTileTone | undefined;
    /** Badges or a count beside the title. */
    readonly aside?: ReactNode | undefined;
    /** A key, a unit caption or an (i), at the head's inline end. */
    readonly trailing?: ReactNode | undefined;
    /** The tile's share of its row when the row is split. */
    readonly weight?: number | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}

export function RecordTile({
    icon,
    title,
    tone = 'raised',
    aside,
    trailing,
    weight = 1,
    children,
    testID,
}: RecordTileProps) {
    const split = useContext(SplitContext);

    return (
        <View
            testID={testID}
            role="region"
            aria-label={title}
            className={`z-auto min-w-0 flex-col gap-snug rounded-xl border p-base shadow-elevation-card ${TILE_TONE_CLASS[tone]}`}
            style={split ? { flex: weight } : undefined}
        >
            {title === undefined ? null : (
                <View className="z-auto flex-row flex-wrap items-center gap-tight">
                    <View
                        aria-hidden
                        className="h-6 w-6 items-center justify-center rounded bg-surface-brand-subtle"
                    >
                        <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
                    </View>
                    <Text variant="strong" testID={`${testID}-title`}>
                        {title}
                    </Text>
                    {aside}
                    {trailing === undefined ? null : (
                        <View className="z-auto ms-auto flex-row flex-wrap items-center gap-snug">
                            {trailing}
                        </View>
                    )}
                </View>
            )}
            {children}
        </View>
    );
}

export interface TileFact {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** A formatted string, or a node for a value that is not plain text (chips). */
    readonly value: string | ReactNode;
    /** Drawn quiet — the value is a dash or a stand-in. */
    readonly empty?: boolean | undefined;
}

/** A tile's label/value pairs, the label on the start side at a fixed track. */
export function TileFacts({
    facts,
    testID,
}: {
    readonly facts: readonly TileFact[];
    readonly testID: string;
}) {
    return (
        <View testID={testID} role="list" className="flex-col gap-tight">
            {facts.map((fact) => (
                <View key={fact.key} role="listitem" className="flex-row items-baseline gap-snug">
                    <View className="w-32 shrink-0">
                        <Text variant="label" tone="secondary">
                            {fact.label}
                        </Text>
                    </View>
                    {/* eslint-disable-next-line no-restricted-syntax -- the value column of a read-only pair, not a control: it takes the rest of the line. */}
                    <View className="min-w-0 flex-1">
                        {typeof fact.value === 'string' ? (
                            <Text
                                variant="body"
                                tone={fact.empty === true ? 'secondary' : 'primary'}
                                testID={`${testID}-${fact.key}`}
                            >
                                {fact.value}
                            </Text>
                        ) : (
                            <View testID={`${testID}-${fact.key}`}>{fact.value}</View>
                        )}
                    </View>
                </View>
            ))}
        </View>
    );
}

/**
 * A tile's empty state: one line in a dashed frame. Never a sentence about the feature.
 *
 * `warning` is for a gap that blocks something — allergens nobody has recorded keep every recipe
 * built on the ingredient from publishing — rather than one that is merely not filled in.
 */
export function TileEmpty({
    text,
    tone = 'neutral',
    testID,
}: {
    readonly text: string;
    readonly tone?: 'neutral' | 'warning' | undefined;
    readonly testID: string;
}) {
    return (
        <View
            testID={testID}
            className={
                tone === 'warning'
                    ? 'rounded-lg border border-warning-border bg-warning-subtle px-snug py-snug'
                    : 'rounded-lg border border-dashed border-stroke px-snug py-snug'
            }
        >
            <Text variant="body" tone={tone === 'warning' ? 'warning' : 'secondary'}>
                {text}
            </Text>
        </View>
    );
}
