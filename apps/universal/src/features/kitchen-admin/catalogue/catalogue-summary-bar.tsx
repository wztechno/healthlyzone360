import { Text } from '@healthy360/design-system';
import { Fragment } from 'react';
import { View } from 'react-native';

/**
 * Part three (§4.1): one 11px line, and the whole of what the KPI tiles used to say.
 *
 * ```
 * 248 of 248 shown · 12 draft · 3 missing Arabic · 7 uncosted
 * ```
 *
 * The four figures were four tiles across the top of the list, which is roughly 96px of vertical
 * space spent on numbers nobody acts on directly — they are orientation, not a dashboard. As a
 * caption line they cost 16px and say the same thing. `kpi-tile.tsx` goes in the §7.9 sweep.
 *
 * **The separator is an element, not a character in a string.** A `·` welded into a translated
 * phrase is a `·` that Arabic cannot reposition and that a screen reader announces as punctuation
 * mid-sentence; segments arrive already translated and already interpolated, and the joining is
 * this component's job. It is the same argument `ListItem`'s `meta` slot makes.
 *
 * Segments that do not apply are simply absent — a list with nothing missing an Arabic name says
 * nothing about Arabic names rather than "0 missing Arabic". A zero is a fact worth reading only
 * when it changed, and this line has no memory.
 */
export interface CatalogueSummaryBarProps {
    /**
     * Translated, interpolated segments in reading order. The first is conventionally the
     * "N of M shown" count; the rest are the exceptions worth knowing about.
     */
    readonly segments: readonly string[];
    readonly testID: string;
}

export function CatalogueSummaryBar({ segments, testID }: CatalogueSummaryBarProps) {
    if (segments.length === 0) return null;

    return (
        <View testID={testID} className="flex-row flex-wrap items-center gap-hair">
            {segments.map((segment, index) => (
                <Fragment key={segment}>
                    {index === 0 ? null : (
                        <Text variant="caption" tone="disabled" aria-hidden>
                            ·
                        </Text>
                    )}
                    <Text variant="caption" tone="secondary">
                        {segment}
                    </Text>
                </Fragment>
            ))}
        </View>
    );
}
