import { Icon, IconButton, useMotion } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { findAmount } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { YourAllergens } from '../../commerce/my-allergens.tsx';
import { formatMoney, nutrientValue } from '../format.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { useShopViewOnly } from '../shop-view-only.tsx';

/** A card is 232 wide with a 16 gap. */
const CARD_STEP = 248;
const AUTOPLAY_MS = 4000;
/** How long the Add button wears its tick after an add. */
const DONE_MS = 1400;

/**
 * "Popular right now" — the accepted design's carousel: cards that move on by one every 4s, stop
 * while the pointer or focus is on them and for good once somebody steps it with the arrows, and
 * go back to the start after the last. Under reduced motion it never moves by itself.
 */
export function PopularCarousel({
    testID,
    meals,
    onAdd,
}: {
    readonly testID: string;
    readonly meals: readonly MarketplaceMeal[];
    readonly onAdd: (meal: MarketplaceMeal) => void;
}) {
    const { t } = useTranslation();
    const { enabled } = useMotion();
    const port = useRef<ScrollView>(null);
    const [place, setPlace] = useState({ x: 0, width: 0, content: 0 });
    const [paused, setPaused] = useState(false);
    const [touched, setTouched] = useState(false);

    const atStart = place.x <= 2;
    const atEnd = place.content > 0 && place.x + place.width >= place.content - 2;

    const scrollTo = useCallback((x: number) => {
        port.current?.scrollTo({ x: Math.max(0, x), animated: true });
    }, []);

    useEffect(() => {
        if (!enabled || paused || touched || meals.length === 0) return;
        const timer = setInterval(() => {
            scrollTo(atEnd ? 0 : place.x + CARD_STEP);
        }, AUTOPLAY_MS);
        return () => {
            clearInterval(timer);
        };
    }, [atEnd, enabled, meals.length, paused, place.x, scrollTo, touched]);

    const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
        setPlace({
            x: Math.abs(contentOffset.x),
            width: layoutMeasurement.width,
            content: contentSize.width,
        });
    };

    const step = (direction: 1 | -1) => {
        setTouched(true);
        scrollTo(place.x + direction * CARD_STEP * 4);
    };

    return (
        <View testID={testID} className="mt-9 flex-col">
            <View className="mb-5 flex-row items-center gap-3">
                <RNText
                    role="heading"
                    aria-level={2}
                    className="me-auto font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('marketplace:discover.popularNow')}
                </RNText>
                <IconButton
                    testID={`${testID}-previous`}
                    size="sm"
                    variant="ghost"
                    className="rounded-full border-stroke"
                    disabled={atStart}
                    label={t('marketplace:discover.previous')}
                    icon={<Icon name="chevronBackward" className="text-content-primary" />}
                    onPress={() => {
                        step(-1);
                    }}
                />
                <IconButton
                    testID={`${testID}-next`}
                    size="sm"
                    variant="ghost"
                    className="rounded-full border-stroke"
                    disabled={atEnd}
                    label={t('marketplace:discover.next')}
                    icon={<Icon name="chevronForward" className="text-content-primary" />}
                    onPress={() => {
                        step(1);
                    }}
                />
            </View>
            <View
                onPointerEnter={() => {
                    setPaused(true);
                }}
                onPointerLeave={() => {
                    setPaused(false);
                }}
            >
                <ScrollView
                    ref={port}
                    testID={`${testID}-track`}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    snapToInterval={CARD_STEP}
                    decelerationRate="fast"
                    onScroll={onScroll}
                    onLayout={(event) => {
                        const { width } = event.nativeEvent.layout;
                        setPlace((current) => ({ ...current, width }));
                    }}
                    onContentSizeChange={(content) => {
                        setPlace((current) => ({ ...current, content }));
                    }}
                    scrollEventThrottle={64}
                    contentContainerClassName="gap-4 px-2 pb-6 pt-2"
                    className="-mx-2"
                >
                    {meals.map((meal) => (
                        <PopularCard
                            key={meal.id}
                            testID={`${testID}-${meal.slug}`}
                            meal={meal}
                            onAdd={() => {
                                onAdd(meal);
                            }}
                            onFocus={() => {
                                setPaused(true);
                            }}
                            onBlur={() => {
                                setPaused(false);
                            }}
                        />
                    ))}
                </ScrollView>
            </View>
        </View>
    );
}

/**
 * One card: the photograph, the name (the link to the meal), its kitchen, the figures the kitchen
 * published, the price and a round Add that turns to a tick for a moment after an add.
 */
function PopularCard({
    testID,
    meal,
    onAdd,
    onFocus,
    onBlur,
}: {
    readonly testID: string;
    readonly meal: MarketplaceMeal;
    readonly onAdd: () => void;
    readonly onFocus: () => void;
    readonly onBlur: () => void;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const viewOnly = useShopViewOnly();
    const { me } = useSession();
    const [hovered, setHovered] = useState(false);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!done) return;
        const timer = setTimeout(() => {
            setDone(false);
        }, DONE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [done]);

    const open = () => {
        router.push(`/meals/${meal.slug}` as never);
    };

    // Only what the kitchen published: "0 cal" would be a claim about the food.
    const figures = [
        findAmount(meal.nutrition, 'energy') === null
            ? null
            : t('marketplace:discover.cardEnergy', {
                  value: formatter.formatNumber(nutrientValue(meal.nutrition, 'energy')),
              }),
        findAmount(meal.nutrition, 'protein') === null
            ? null
            : t('marketplace:discover.cardProtein', {
                  value: formatter.formatNumber(nutrientValue(meal.nutrition, 'protein')),
              }),
    ].filter((figure): figure is string => figure !== null);

    return (
        <View
            testID={testID}
            onPointerEnter={() => {
                setHovered(true);
            }}
            onPointerLeave={() => {
                setHovered(false);
            }}
            className={[
                'w-[232px] flex-col overflow-hidden rounded-2xl border border-stroke-subtle bg-surface-raised transition duration-normal ease-standard',
                hovered ? '-translate-y-1 shadow-elevation-card-hover' : '',
            ].join(' ')}
        >
            {/* The photograph opens the meal for a pointer; the name below is the announced link. */}
            <Pressable
                testID={`${testID}-media`}
                onPress={open}
                focusable={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                aria-hidden
                className="h-[174px] overflow-hidden"
            >
                <View
                    className={
                        hovered
                            ? 'h-[174px] scale-105 transition duration-slow ease-standard'
                            : 'h-[174px] transition duration-slow ease-standard'
                    }
                >
                    <EntityImage
                        assetId={meal.imagePlaceholderId}
                        photoUrl={meal.photoUrl}
                        seed={meal.slug}
                        label={t('marketplace:menu.imageLabel', { meal: meal.name })}
                        decorative
                        flush
                        className="h-[174px]"
                    />
                </View>
            </Pressable>
            {/* The body grows, so the price and Add sit on the card's bottom edge in every card. */}
            <View className="flex-1 flex-col px-4 pb-4 pt-3">
                <Pressable
                    testID={`${testID}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={meal.name}
                    onPress={open}
                    onFocus={onFocus}
                    onBlur={onBlur}
                >
                    <RNText
                        numberOfLines={1}
                        className="text-base font-semibold leading-snug text-content-primary text-start"
                    >
                        {meal.name}
                    </RNText>
                </Pressable>
                <RNText
                    numberOfLines={1}
                    className="mt-0.5 text-xs text-content-secondary text-start"
                >
                    {meal.kitchenName}
                </RNText>
                {figures.length === 0 ? null : (
                    <View className="mt-2.5 flex-row gap-1.5">
                        {figures.map((figure) => (
                            <RNText
                                key={figure}
                                className="rounded-full bg-surface-brand-subtle px-2 py-0.5 text-xs font-semibold tabular-nums text-content-on-brand-subtle"
                            >
                                {figure}
                            </RNText>
                        ))}
                    </View>
                )}
                <YourAllergens allergens={meal.allergens} testID={`${testID}-your-allergens`} />
                <View className="mt-auto flex-row items-center justify-between pt-3">
                    <RNText
                        testID={`${testID}-price`}
                        className="font-display text-lg font-bold tabular-nums text-content-primary"
                    >
                        {formatMoney(formatter, meal.price)}
                    </RNText>
                    {/* Staff view the shop and add nothing (`shop-view-only.tsx`). */}
                    {viewOnly ? null : (
                        <Pressable
                            testID={`${testID}-add`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('marketplace:discover.addLabel', {
                                meal: meal.name,
                            })}
                            onPress={() => {
                                onAdd();
                                // A signed-out add asks how to continue first, so it has not happened yet.
                                if (me !== null) setDone(true);
                            }}
                            onFocus={onFocus}
                            onBlur={onBlur}
                            className={
                                done
                                    ? 'h-11 w-11 items-center justify-center rounded-full bg-content-primary'
                                    : 'h-11 w-11 items-center justify-center rounded-full bg-surface-brand transition duration-fast ease-standard active:scale-90'
                            }
                        >
                            <Icon
                                name={done ? 'check' : 'plus'}
                                className={done ? 'text-surface-base' : 'text-content-on-brand'}
                            />
                        </Pressable>
                    )}
                </View>
            </View>
        </View>
    );
}
