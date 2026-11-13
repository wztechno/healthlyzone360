import { Icon } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { createElement, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View, useWindowDimensions } from 'react-native';

import { mealsFromPages, useMealsQuery } from '../data/catalogue-hooks.ts';
import { EntityImage } from '../media/entity-image.tsx';

/**
 * The sign-in pages' stage, on the web — the accepted boards' dark green panel: two soft shapes
 * drifting in the corners, the logo, three dishes from the real menu floating on frosted cards, and
 * "Good food, ready when you are." at the foot.
 *
 * The motion is CSS keyframes (drift for the shapes, a slow float for the cards, each card a third
 * of a cycle behind the last), so it costs no JavaScript per frame; `prefers-reduced-motion` stops
 * it. Every colour is a token variable. The dishes are whatever the menu serves first — the stage
 * says "this is food", it advertises nothing in particular — and while they load the cards wait.
 */

const STYLE_ID = 'h360-auth-stage';
const STYLES = `
@keyframes h360-drift{from{transform:translate3d(0,0,0) rotate(0deg)}to{transform:translate3d(18px,16px,0) rotate(10deg)}}
@keyframes h360-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.h360-blob-a{position:absolute;top:-160px;inset-inline-end:-140px;width:520px;height:520px;color:rgb(var(--h360-color-stage-green) / .16);animation:h360-drift 24s ease-in-out infinite alternate}
.h360-blob-b{position:absolute;bottom:-120px;inset-inline-start:-100px;width:360px;height:360px;color:rgb(var(--h360-color-on-canopy) / .06);animation:h360-drift 30s ease-in-out infinite alternate-reverse}
.h360-dish{position:absolute;animation:h360-floaty 7s ease-in-out infinite}
.h360-dish-2{animation-delay:-2.4s}
.h360-dish-3{animation-delay:-4.8s}
@media (prefers-reduced-motion: reduce){.h360-blob-a,.h360-blob-b,.h360-dish{animation:none}}
`;

function useStageStyles(): void {
    useEffect(() => {
        if (typeof document === 'undefined' || document.getElementById(STYLE_ID) !== null) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLES;
        document.head.appendChild(style);
    }, []);
}

const BLOB_A =
    'M44.7,-58.6C57.5,-50.3,67,-36.6,71.4,-21.4C75.8,-6.2,75.1,10.5,68.7,24.6C62.3,38.7,50.2,50.2,36.4,58.9C22.6,67.6,7.1,73.5,-9.6,74.2C-26.3,74.9,-44.2,70.4,-56.2,59.4C-68.2,48.4,-74.3,30.9,-75.6,13.7C-76.9,-3.5,-73.4,-20.4,-64.6,-33.6C-55.8,-46.8,-41.7,-56.3,-27.4,-63.9C-13.1,-71.5,1.4,-77.2,15.4,-75.1C29.4,-73,31.9,-66.9,44.7,-58.6Z';
const BLOB_B =
    'M39.9,-49.2C51.3,-38.6,60,-25.4,64.3,-10.2C68.6,5,68.5,22.2,60.5,34.6C52.5,47,36.6,54.6,20.2,60.3C3.8,66,-13.1,69.8,-28.6,65.2C-44.1,60.6,-58.2,47.6,-65.6,31.5C-73,15.4,-73.7,-3.8,-67.3,-19.9C-60.9,-36,-47.4,-49,-32.9,-58.8C-18.4,-68.6,-2.9,-75.2,10.6,-71.9C24.1,-68.6,28.5,-59.8,39.9,-49.2Z';

function blob(className: string, d: string) {
    return createElement(
        'svg',
        { className, viewBox: '0 0 200 200', 'aria-hidden': true },
        createElement('path', { fill: 'currentColor', d, transform: 'translate(100 100)' }),
    );
}

/** Where each card floats: the boards' three positions, staggered down the stage. */
const DISH_PLACES = [
    { top: 170, start: 48 },
    { top: 300, end: 44 },
    { top: 430, start: 110 },
] as const;

/** A card's height, and the room the headline needs at the stage's foot (with its margins). */
const DISH_HEIGHT = 82;
const HEADLINE_ROOM = 200;

function DishCard({ meal }: { readonly meal: MarketplaceMeal }) {
    return (
        <View className="flex-row items-center gap-3 rounded-[20px] border border-content-on-canopy/15 bg-content-on-canopy/10 py-2 pe-4 ps-2 shadow-elevation-3 web:backdrop-blur-md">
            <View className="h-16 w-16 overflow-hidden rounded-[14px]">
                <EntityImage
                    assetId={meal.imagePlaceholderId}
                    photoUrl={meal.photoUrl}
                    seed={meal.slug}
                    label={meal.name}
                    decorative
                    flush
                    className="h-16 w-16"
                />
            </View>
            <View className="max-w-[220px]">
                <RNText
                    numberOfLines={1}
                    className="text-base font-bold text-content-on-canopy text-start"
                >
                    {meal.name}
                </RNText>
                <RNText
                    numberOfLines={1}
                    className="text-xs font-medium text-content-on-canopy-muted text-start"
                >
                    {meal.kitchenName}
                </RNText>
            </View>
        </View>
    );
}

export function AuthStage() {
    useStageStyles();
    const { t } = useTranslation();
    const { height } = useWindowDimensions();
    const meals = useMealsQuery({ itemTypes: ['meal'], limit: 12 });
    const dishes = useMemo(() => {
        const all = mealsFromPages(meals.data?.pages);
        // Photographed dishes first: the stage is a picture of food.
        const withPhoto = all.filter((meal) => (meal.photoUrl ?? null) !== null);
        // A card shows only where it clears the headline: on a short window the lower ones wait.
        const room = DISH_PLACES.filter(
            (place) => place.top + DISH_HEIGHT <= height - HEADLINE_ROOM,
        ).length;
        return [...withPhoto, ...all.filter((meal) => !withPhoto.includes(meal))].slice(0, room);
    }, [height, meals.data]);

    return (
        <View
            testID="auth-stage"
            aria-hidden
            className="relative m-3 w-[620px] shrink-0 overflow-hidden rounded-[28px] bg-surface-canopy px-9 py-8"
        >
            {blob('h360-blob-a', BLOB_A)}
            {blob('h360-blob-b', BLOB_B)}

            <View className="flex-row items-center gap-2.5">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-stage-green">
                    <Icon name="leaf" className="text-surface-canopy" />
                </View>
                <RNText className="font-display text-xl font-bold text-content-on-canopy">
                    {t('marketplace:brand.name')}
                </RNText>
            </View>

            {dishes.map((meal, index) => {
                const place = DISH_PLACES[index] ?? DISH_PLACES[0];
                return createElement(
                    'div',
                    {
                        key: meal.id,
                        className: `h360-dish h360-dish-${String(index + 1)}`,
                        style: {
                            top: place.top,
                            ...('start' in place
                                ? { insetInlineStart: place.start }
                                : { insetInlineEnd: place.end }),
                        },
                    },
                    <DishCard meal={meal} />,
                );
            })}

            <RNText className="absolute bottom-10 end-9 start-9 font-display text-5xl font-bold leading-[56px] text-content-on-canopy text-start">
                {t('auth:frame.headline')}
                {'\n'}
                <RNText className="text-stage-green">{t('auth:frame.headlineAccent')}</RNText>
            </RNText>
        </View>
    );
}
