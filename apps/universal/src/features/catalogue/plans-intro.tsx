import { useBreakpoint } from '@healthy360/design-system';
import { Children } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Eyebrow } from '../../ui/eyebrow.tsx';
import { TextLink } from './plan-controls.tsx';

/**
 * The opening of `/plans`, as HealthZone draws it: no canopy band, just the eyebrow, the two-line
 * display title, one sentence on how a plan works and the inline "How plans work →" link, all held
 * to the design's `60ch` measure.
 *
 * The sentence names the change cut-off rather than the design's flat "24 hours": the cut-off is
 * each plan's own `change_cutoff_hours`, 24 by default, and a kitchen may set another.
 */
export function PlansIntro({ onHowItWorks }: { readonly onHowItWorks: () => void }) {
    const { t } = useTranslation();

    return (
        <View testID="plans-intro" className="max-w-[600px] flex-col items-start">
            <Eyebrow testID="plans-eyebrow">{t('catalogue:plans.eyebrow')}</Eyebrow>
            <RNText
                testID="plans-title"
                accessibilityRole="header"
                aria-level={1}
                className="mt-3 max-w-[500px] font-display text-4xl font-bold leading-[1.05] tracking-display text-content-primary text-start lg:text-5xl lg:leading-[1.05]"
            >
                {t('catalogue:plans.title')}
            </RNText>
            <RNText
                testID="plans-subtitle"
                className="mt-2.5 text-base leading-relaxed text-content-secondary text-start"
            >
                {t('catalogue:plans.subtitle')}
            </RNText>
            <TextLink
                testID="plans-how-link"
                label={t('catalogue:plans.howItWorksLink')}
                onPress={onHowItWorks}
            />
        </View>
    );
}

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
