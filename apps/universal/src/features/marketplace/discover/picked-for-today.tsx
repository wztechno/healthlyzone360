import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useMotion } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    Text as RNText,
    ScrollView,
    View,
} from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';

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
    if (cards.length === 0) return null;

    return (
        <View testID={testID} className="mt-7 flex-col">
            <RNText
                role="heading"
                aria-level={2}
                className="mb-5 font-display text-2xl font-bold tracking-display text-content-primary text-start"
            >
                {t('marketplace:discover.pickedTitle')}
            </RNText>
            {/* Centred while the cards fit; a phone scrolls them. */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerClassName="grow justify-center"
            >
                <View className="flex-row gap-3 px-0.5 pb-2 pt-1">
                    {cards.map((card, index) => (
                        <Rise key={`${entranceKey ?? ''}:${card.key}`} index={index}>
                            <PickCard testID={`${testID}-${card.key}`} card={card} />
                        </Rise>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

function PickCard({ testID, card }: { readonly testID: string; readonly card: PickedCard }) {
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
                'relative h-40 w-40 overflow-hidden rounded-2xl p-4 transition duration-normal ease-standard',
                tint.fill,
                hovered ? '-translate-y-1' : '',
            ].join(' ')}
        >
            <RNText
                className={`relative z-raised max-w-[120px] font-display text-lg font-bold leading-tight tracking-display text-start ${tint.ink}`}
            >
                {headline}
            </RNText>
            {card.meal === undefined ? null : (
                <View
                    aria-hidden
                    className={[
                        'absolute -bottom-3 -end-3 h-[92px] w-[92px] overflow-hidden rounded-full transition duration-slow ease-standard',
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
                        className="h-[92px] w-[92px]"
                    />
                </View>
            )}
        </Pressable>
    );
}

/** The design's `up` entrance, as the carousel below uses it: a 12px rise and fade, a beat apart. */
function Rise({ index, children }: { readonly index: number; readonly children: ReactNode }) {
    const { enabled } = useMotion();
    const [shown] = useState(() => new Animated.Value(enabled ? 0 : 1));
    useEffect(() => {
        if (!enabled) {
            shown.setValue(1);
            return undefined;
        }
        const animation = Animated.timing(shown, {
            toValue: 1,
            duration: 600,
            delay: Math.min(index, 6) * 60,
            easing: Easing.bezier(0.2, 0.7, 0.2, 1),
            useNativeDriver: Platform.OS !== 'web',
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, index, shown]);
    return (
        <Animated.View
            style={{
                opacity: shown,
                transform: [
                    { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                ],
            }}
        >
            {children}
        </Animated.View>
    );
}
