import { Icon, cx, useMotion } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { TINT_FILL, TINT_INK } from '../catalogue/shelf-tints.ts';
import { KitchenQuickLook } from './kitchen-quick-look.tsx';
import {
    kitchenTags,
    kitchenWhere,
    todayLabel,
    todayWindow,
    useKitchenTallies,
} from './kitchen-card-facts.ts';

/**
 * One kitchen in the `/kitchens` finder, as the accepted shop board draws it: a cover with today's
 * hours on it and a Quick look button, three of its dishes overlapping the cover's foot, its logo,
 * name and where it cooks, what it is known for, three counts — items, areas, plans — and "Open
 * {kitchen}". The whole card opens the storefront; Quick look opens the kitchen's summary in place.
 *
 * - **Today's hours, not "open now".** "Open" is a claim about this instant in the kitchen's time
 *   zone, which `storefront-facts.ts` explains cannot be made reliably on native. The chip states
 *   today's published window, and is absent for a kitchen that publishes no hours at all.
 * - **The counts are counted.** Items are the kitchen's listing (with "+" when there are more than
 *   one page), areas its delivery zones, plans its published plans. A count not yet known is a dash.
 * - **Delivery terms and rating** — not drawn on the board's card — are in Quick look.
 */
export interface KitchenFinderCardProps {
    readonly kitchen: Kitchen;
    readonly testID?: string | undefined;
}

export function KitchenFinderCard({ kitchen, testID }: KitchenFinderCardProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const id = testID ?? `kitchen-card-${kitchen.slug}`;
    const { axisSign } = useMotion();
    const [hovered, setHovered] = useState(false);
    const [looking, setLooking] = useState(false);
    const tallies = useKitchenTallies(kitchen);

    const today = todayWindow(kitchen);
    const tags = kitchenTags(kitchen, t);
    const dash = t('marketplace:kitchens.noCount');
    const open = () => {
        router.push(`/kitchens/${String(kitchen.id)}` as never);
    };

    return (
        <View
            testID={id}
            onPointerEnter={() => {
                setHovered(true);
            }}
            onPointerLeave={() => {
                setHovered(false);
            }}
            className={cx(
                'relative flex-1 flex-col overflow-hidden rounded-[26px] border border-stroke-subtle bg-surface-raised transition duration-normal ease-standard',
                hovered ? '-translate-y-1 shadow-elevation-card-hover' : '',
            )}
        >
            {/* The cover opens the kitchen for a pointer; the card's link below is the named one. */}
            <Pressable
                testID={`${id}-cover`}
                onPress={open}
                focusable={false}
                aria-hidden
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                className="h-[170px] overflow-hidden bg-surface-canopy"
            >
                <View
                    className={cx(
                        'h-[170px] transition duration-slow ease-emphasized',
                        hovered ? 'scale-[1.07]' : '',
                    )}
                >
                    <EntityImage
                        testID={`${id}-image`}
                        assetId={kitchen.imagePlaceholderId}
                        variant="card"
                        seed={kitchen.slug}
                        label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                        decorative
                        flush
                        className="h-[170px]"
                    />
                </View>
            </Pressable>

            {today === undefined ? null : (
                <View
                    pointerEvents="none"
                    className="absolute start-3 top-3 h-7 flex-row items-center gap-1.5 rounded-full bg-surface-raised px-2.5"
                >
                    <View
                        className={cx(
                            'h-2 w-2 rounded-full',
                            today === null ? 'bg-stroke' : 'bg-surface-brand',
                        )}
                    />
                    <RNText
                        testID={`${id}-today`}
                        className={cx(
                            'text-xs font-bold uppercase tracking-wide',
                            today === null ? 'text-content-secondary' : 'text-content-primary',
                        )}
                    >
                        {todayLabel(today, t)}
                    </RNText>
                </View>
            )}

            <Pressable
                testID={`${id}-quick-look`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('marketplace:kitchens.quickLookLabel', {
                    kitchen: kitchen.name,
                })}
                onPress={() => {
                    setLooking(true);
                }}
                className={cx(
                    'absolute end-2.5 top-2.5 h-9 flex-row items-center gap-1.5 rounded-full bg-surface-inverse/75 px-3 transition duration-normal ease-standard focus:opacity-100',
                    hovered ? 'opacity-100' : 'web:opacity-0',
                )}
            >
                <Icon name="eye" size="sm" className="text-content-inverse" />
                <RNText className="text-xs font-semibold text-content-inverse">
                    {t('marketplace:kitchens.quickLook')}
                </RNText>
            </Pressable>

            {tallies.dishes.length === 0 ? null : (
                <View
                    aria-hidden
                    pointerEvents="none"
                    className="absolute end-[18px] top-[186px] flex-row"
                >
                    {tallies.dishes.map((dish, index) => (
                        <View
                            key={dish.id}
                            className={cx(
                                'h-10 w-10 overflow-hidden rounded-full border-[3px] border-surface-raised transition-all duration-normal ease-emphasized',
                                index === 0 ? '' : hovered ? '-ms-1' : '-ms-3',
                                hovered && index === 1 ? '-translate-y-1' : '',
                            )}
                        >
                            <EntityImage
                                assetId={dish.imagePlaceholderId}
                                photoUrl={dish.photoUrl}
                                seed={dish.slug}
                                label={dish.name}
                                decorative
                                flush
                                className="h-full w-full"
                            />
                        </View>
                    ))}
                </View>
            )}

            <View className="flex-1 flex-col px-[18px] pb-[18px]">
                <View className="-mt-8 h-16 w-16 overflow-hidden rounded-[20px] border-4 border-surface-raised bg-surface-raised shadow-elevation-2">
                    <EntityImage
                        assetId={kitchen.imagePlaceholderId}
                        seed={`${kitchen.slug}-logo`}
                        label={kitchen.name}
                        decorative
                        flush
                        className="h-full w-full"
                    />
                </View>
                <RNText
                    numberOfLines={1}
                    className="mt-2.5 font-display text-xl font-bold text-content-primary text-start"
                >
                    {kitchen.name}
                </RNText>
                <RNText
                    testID={`${id}-where`}
                    numberOfLines={1}
                    className="mt-0.5 text-sm text-content-secondary text-start"
                >
                    {kitchenWhere(kitchen, t)}
                </RNText>

                {tags.length === 0 && !kitchen.isVerified ? null : (
                    <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                        {kitchen.isVerified ? (
                            <View
                                testID={`${id}-verified`}
                                className="h-6 flex-row items-center gap-1 rounded-full bg-surface-brand-subtle px-2.5"
                            >
                                <Icon
                                    name="badgeCheck"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                                <RNText className="text-xs font-semibold text-content-on-brand-subtle">
                                    {t('marketplace:kitchens.verified')}
                                </RNText>
                            </View>
                        ) : null}
                        {tags.map((tag) => (
                            <View
                                key={tag.label}
                                className={cx(
                                    'h-6 justify-center rounded-full px-2.5',
                                    TINT_FILL[tag.tint],
                                )}
                            >
                                <RNText className={cx('text-xs font-semibold', TINT_INK[tag.tint])}>
                                    {tag.label}
                                </RNText>
                            </View>
                        ))}
                    </View>
                )}

                <View className="mt-3.5 flex-row gap-1.5 rounded-2xl bg-surface-base p-1">
                    {[
                        { key: 'items', value: tallies.items, label: 'cardItems' },
                        { key: 'areas', value: tallies.areas, label: 'cardAreas' },
                        { key: 'plans', value: tallies.plans, label: 'cardPlans' },
                    ].map((cell) => (
                        <View
                            key={cell.key}
                            testID={`${id}-${cell.key}`}
                            className="flex-1 flex-col items-center rounded-[10px] bg-surface-raised px-0.5 py-1.5"
                        >
                            <RNText className="font-display text-base font-bold tabular-nums text-content-primary">
                                {cell.value ?? dash}
                            </RNText>
                            <RNText className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                                {t(`marketplace:kitchens.${cell.label}`)}
                            </RNText>
                        </View>
                    ))}
                </View>

                <Pressable
                    testID={`${id}-open`}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={t('marketplace:kitchens.cardLabel', {
                        kitchen: kitchen.name,
                    })}
                    onPress={open}
                    className="mt-2.5 min-h-touch flex-row items-center justify-between"
                >
                    <RNText
                        numberOfLines={1}
                        className="min-w-0 shrink text-sm font-semibold text-content-brand text-start"
                    >
                        {t('marketplace:kitchens.openKitchen', { kitchen: kitchen.name })}
                    </RNText>
                    {/* The arrow steps 4px onward on hover — rightward, or leftward in Arabic. */}
                    <View
                        className="transition duration-normal ease-standard"
                        style={{ transform: [{ translateX: hovered ? 4 * axisSign : 0 }] }}
                    >
                        <Icon name="chevronForward" size="sm" className="text-content-brand" />
                    </View>
                </Pressable>
            </View>

            <KitchenQuickLook
                testID={`${id}-quick`}
                cardTestID={id}
                kitchen={kitchen}
                tallies={tallies}
                open={looking}
                onClose={() => {
                    setLooking(false);
                }}
                onOpenKitchen={() => {
                    setLooking(false);
                    open();
                }}
            />
        </View>
    );
}
