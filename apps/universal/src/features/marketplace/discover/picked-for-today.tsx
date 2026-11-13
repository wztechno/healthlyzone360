import { cx, useBreakpoint } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { RiseIn } from '../../../ui/rise-in.tsx';

/** The tint a card wears — the design's colour-coded cards, from the token family of that name. */
export type PickTint = 'green' | 'blue' | 'orange' | 'yellow' | 'pink' | 'violet' | 'teal';

export interface PickedCard {
    readonly key: string;
    /** The card's line, as a catalogue key — or, for a dish, its own name in `headline`. */
    readonly headlineKey?: string | undefined;
    readonly headline?: string | undefined;
    readonly href: string;
    readonly tint: PickTint;
    readonly meal: MarketplaceMeal | undefined;
}

/*
 * Written out, not composed: a class built from a variable is a class Tailwind never saw, and so a
 * class with no rule.
 */
const TINT_CLASS: Readonly<Record<PickTint, { readonly fill: string; readonly ink: string }>> = {
    green: { fill: 'bg-tint-green', ink: 'text-tint-green-on' },
    blue: { fill: 'bg-tint-blue', ink: 'text-tint-blue-on' },
    orange: { fill: 'bg-tint-orange', ink: 'text-tint-orange-on' },
    yellow: { fill: 'bg-tint-yellow', ink: 'text-tint-yellow-on' },
    pink: { fill: 'bg-tint-pink', ink: 'text-tint-pink-on' },
    violet: { fill: 'bg-tint-violet', ink: 'text-tint-violet-on' },
    teal: { fill: 'bg-tint-teal', ink: 'text-tint-teal-on' },
};

/**
 * "Picked for today" — the accepted design's row of colour-coded cards, each a headline and a
 * round photograph tucked into its corner. There is no promotions feed, so every card is a
 * shortcut to a real place (a shelf of the menu, the plans, the kitchens) and claims nothing about
 * an offer or a price.
 */
export function PickedForToday({
    testID,
    cards,
    entranceKey,
}: {
    readonly testID: string;
    readonly cards: readonly PickedCard[];
    /** A new key — another shelf chosen above — rises the row in again. */
    readonly entranceKey?: string | undefined;
}) {
    const { t } = useTranslation();
    // Shop · Discover — phone: 136px cards with a smaller face, a 10 gap and an 18px heading.
    const compact = !useBreakpoint().atLeast('md');
    if (cards.length === 0) return null;

    return (
        <View testID={testID} className={cx('flex-col', compact ? 'mt-1' : 'mt-7')}>
            <RNText
                role="heading"
                aria-level={2}
                className={cx(
                    'font-display font-bold tracking-display text-content-primary text-start',
                    compact ? 'mb-2.5 text-lg' : 'mb-5 text-2xl',
                )}
            >
                {t('marketplace:discover.pickedTitle')}
            </RNText>
            {/* Shop · Discover: the strip starts under the heading, as the board draws it, and
                scrolls when the cards do not fit. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className={cx('flex-row px-0.5 pb-2 pt-1', compact ? 'gap-2.5' : 'gap-3')}>
                    {cards.map((card, index) => (
                        <RiseIn key={`${entranceKey ?? ''}:${card.key}`} index={index}>
                            <PickCard
                                testID={`${testID}-${card.key}`}
                                card={card}
                                compact={compact}
                            />
                        </RiseIn>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function PickCard({
    testID,
    card,
    compact,
}: {
    readonly testID: string;
    readonly card: PickedCard;
    readonly compact: boolean;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const [hovered, setHovered] = useState(false);
    const tint = TINT_CLASS[card.tint];
    const headline = card.headline ?? (card.headlineKey === undefined ? '' : t(card.headlineKey));

    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={headline}
            onPress={() => {
                router.push(card.href as never);
            }}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            className={[
                'relative overflow-hidden rounded-2xl transition duration-normal ease-standard',
                compact ? 'h-[136px] w-[136px] p-3' : 'h-40 w-40 p-4',
                tint.fill,
                hovered ? '-translate-y-1' : '',
            ].join(' ')}
        >
            <RNText
                className={cx(
                    'relative z-raised font-display font-bold leading-tight tracking-display text-start',
                    compact ? 'max-w-[104px] text-base' : 'max-w-[120px] text-lg',
                    tint.ink,
                )}
            >
                {headline}
            </RNText>
            {card.meal === undefined ? null : (
                <View
                    aria-hidden
                    className={[
                        'absolute -bottom-3 -end-3 overflow-hidden rounded-full transition duration-slow ease-standard',
                        compact ? 'h-[78px] w-[78px]' : 'h-[92px] w-[92px]',
                        hovered ? 'rotate-[-4deg] scale-105' : '',
                    ].join(' ')}
                >
                    <EntityImage
                        assetId={card.meal.imagePlaceholderId}
                        photoUrl={card.meal.photoUrl}
                        seed={card.meal.slug}
                        label={headline}
                        decorative
                        flush
                        className={compact ? 'h-[78px] w-[78px]' : 'h-[92px] w-[92px]'}
                    />
                </View>
            )}
        </Pressable>
    );
}
