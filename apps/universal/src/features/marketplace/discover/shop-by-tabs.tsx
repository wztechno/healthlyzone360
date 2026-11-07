import { Icon, cx, useBreakpoint, useMotion } from '@healthy360/design-system';
import type { MarketplaceMeal } from '@healthy360/api-client/contracts';
import { memo, useEffect, useState } from 'react';
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

/** A tab is 100 wide with a 16 gap, so the indicator moves 116 per tab — a phone's, 72 and 12. */
const TAB_STEP = 116;
const PHONE_TAB_STEP = 84;

export interface ShopByTab {
    /** `null` for All; otherwise the shelf code the menu filters on. */
    readonly code: string | null;
    readonly label: string;
    /** The dish whose photograph fills the tile; none for All, which draws a glyph. */
    readonly meal: MarketplaceMeal | undefined;
}

/**
 * "Shop by" — the menu's shelves as photo tiles, as the accepted design draws them: a 100px tile
 * with a dish in it and the shelf's name under it, the chosen one ringed in brand with a short
 * bar sliding beneath. Choosing one narrows "Popular right now" below; nothing navigates.
 */
export function ShopByTabs({
    testID,
    tabs,
    selected,
    onSelect,
}: {
    readonly testID: string;
    readonly tabs: readonly ShopByTab[];
    readonly selected: string | null;
    readonly onSelect: (code: string | null) => void;
}) {
    const { t } = useTranslation();
    const { enabled, axisSign } = useMotion();
    // Shop · Discover — phone: 72px tiles with a 48px face, 12 apart, scrolling from the edge.
    const compact = !useBreakpoint().atLeast('md');
    const tabStep = compact ? PHONE_TAB_STEP : TAB_STEP;
    const index = Math.max(
        0,
        tabs.findIndex((tab) => tab.code === selected),
    );
    const target = index * tabStep * axisSign;
    const [offset] = useState(() => new Animated.Value(target));

    useEffect(() => {
        // The web slides the bar with a CSS transition instead — no JavaScript per frame.
        if (Platform.OS === 'web') return undefined;
        const animation = Animated.timing(offset, {
            toValue: index * tabStep * axisSign,
            duration: enabled ? 350 : 0,
            easing: Easing.bezier(0.22, 1, 0.36, 1),
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [axisSign, enabled, index, offset, tabStep]);

    return (
        <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="mx-auto"
        >
            <View
                testID={testID}
                role="tablist"
                aria-label={t('marketplace:discover.shopBy')}
                className={cx(
                    'relative flex-row px-0.5 pt-1',
                    compact ? 'gap-3 pb-3.5' : 'gap-4 pb-[18px]',
                )}
            >
                {tabs.map((tab) => (
                    <ShopByTile
                        key={tab.code ?? 'all'}
                        testID={`${testID}-${tab.code ?? 'all'}`}
                        code={tab.code}
                        label={tab.label}
                        meal={tab.meal}
                        on={tab.code === selected}
                        onSelect={onSelect}
                        compact={compact}
                    />
                ))}
                {Platform.OS === 'web' ? (
                    <View
                        aria-hidden
                        pointerEvents="none"
                        className={[
                            'absolute bottom-1 start-0.5 h-1 w-[100px] items-center',
                            enabled ? 'transition-transform duration-slow ease-standard' : '',
                        ].join(' ')}
                        style={{ transform: [{ translateX: target }] }}
                    >
                        <View className="h-1 w-9 rounded-full bg-surface-brand" />
                    </View>
                ) : (
                    <Animated.View
                        aria-hidden
                        pointerEvents="none"
                        className="absolute bottom-1 start-0.5 h-1 w-[100px] items-center"
                        style={{ transform: [{ translateX: offset }] }}
                    >
                        <View className="h-1 w-9 rounded-full bg-surface-brand" />
                    </Animated.View>
                )}
            </View>
        </ScrollView>
    );
}

/** Memoised: a shelf switch re-draws the two tiles whose ring moved, not every photograph. */
const ShopByTile = memo(function ShopByTile({
    testID,
    code,
    label,
    meal,
    on,
    onSelect,
    compact,
}: {
    readonly testID: string;
    readonly code: string | null;
    readonly label: string;
    readonly meal: MarketplaceMeal | undefined;
    readonly on: boolean;
    readonly onSelect: (code: string | null) => void;
    readonly compact: boolean;
}) {
    // State, not a hover class: the tint belongs on the tile inside, while the pointer target is
    // the whole tab, its label included.
    const [hovered, setHovered] = useState(false);

    return (
        <Pressable
            testID={testID}
            role="tab"
            accessibilityRole="tab"
            aria-selected={on}
            accessibilityState={{ selected: on }}
            onPress={() => {
                onSelect(code);
            }}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            className={cx(
                'flex-col items-center',
                compact ? 'w-[72px] gap-2' : 'w-[100px] gap-2.5',
            )}
        >
            <View
                className={[
                    'items-center justify-center overflow-hidden border-2 transition duration-normal ease-standard',
                    compact
                        ? 'h-[72px] w-[72px] rounded-[18px]'
                        : 'h-[100px] w-[100px] rounded-[20px]',
                    on ? 'border-surface-brand' : 'border-transparent',
                    hovered ? '-translate-y-0.5 bg-surface-brand-subtle' : 'bg-surface-sunken',
                ].join(' ')}
            >
                {meal === undefined ? (
                    <Icon name="layoutGrid" size="lg" className="text-content-primary" />
                ) : (
                    // The board's dish sits inside the tile as a rounded face, not edge to edge.
                    <View
                        className={cx(
                            'overflow-hidden',
                            compact ? 'h-12 w-12 rounded-xl' : 'h-16 w-16 rounded-2xl',
                        )}
                    >
                        <EntityImage
                            assetId={meal.imagePlaceholderId}
                            photoUrl={meal.photoUrl}
                            seed={meal.slug}
                            label={label}
                            decorative
                            flush
                            aspect="square"
                            className="h-full w-full"
                        />
                    </View>
                )}
            </View>
            <RNText
                numberOfLines={1}
                className={
                    on
                        ? 'text-sm font-semibold text-content-on-brand-subtle'
                        : 'text-sm font-semibold text-content-secondary'
                }
            >
                {label}
            </RNText>
        </Pressable>
    );
});
