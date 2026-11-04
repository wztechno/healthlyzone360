import { Icon, cx } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Text as RNText, View } from 'react-native';

import { EntityImage } from '../../media/entity-image.tsx';
import { TINT_FILL, TINT_INK } from '../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../catalogue/shelf-tints.ts';
import {
    kitchenFacts,
    kitchenTags,
    kitchenWhere,
    todayLabel,
    todayWindow,
} from './kitchen-card-facts.ts';
import type { KitchenTallies } from './kitchen-card-facts.ts';

/** The window tiles' colours, in turn. */
const WINDOW_TINTS: readonly ShelfTint[] = ['orange', 'green', 'yellow', 'blue'];

/**
 * Quick look — the accepted board's kitchen summary, opened from a card without leaving the finder:
 * on the start side the kitchen on its cover with today's hours and its three counts; on the end
 * side its delivery windows, three of its dishes, what it is known for, its delivery terms and
 * rating, then "Keep browsing" and "Open kitchen".
 *
 * A real modal: it takes focus, the scrim and Escape close it, and nothing behind it is reachable.
 */
export function KitchenQuickLook({
    testID,
    cardTestID,
    kitchen,
    tallies,
    open,
    onClose,
    onOpenKitchen,
}: {
    readonly testID: string;
    /** The card's own handle — the terms and rating keep the handles they had on the card. */
    readonly cardTestID: string;
    readonly kitchen: Kitchen;
    readonly tallies: KitchenTallies;
    readonly open: boolean;
    readonly onClose: () => void;
    readonly onOpenKitchen: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const today = todayWindow(kitchen);
    const facts = kitchenFacts(kitchen, formatter, t);
    const tags = kitchenTags(kitchen, t);
    const dash = t('marketplace:kitchens.noCount');

    return (
        <Modal transparent visible={open} onRequestClose={onClose} animationType="fade">
            <View className="flex-1 items-center justify-center p-4">
                <Pressable
                    testID={`${testID}-scrim`}
                    accessibilityLabel={t('marketplace:kitchens.close')}
                    onPress={onClose}
                    className="absolute bottom-0 end-0 start-0 top-0 bg-surface-inverse/50"
                />
                <View
                    testID={testID}
                    role="dialog"
                    aria-modal
                    aria-label={kitchen.name}
                    className="w-full max-w-[880px] flex-col overflow-hidden rounded-[28px] bg-surface-raised shadow-elevation-4 lg:h-[520px] lg:flex-row"
                >
                    <View className="relative h-[280px] bg-surface-canopy lg:h-auto lg:w-[360px]">
                        <View className="absolute bottom-0 end-0 start-0 top-0 opacity-45">
                            <EntityImage
                                assetId={kitchen.imagePlaceholderId}
                                seed={kitchen.slug}
                                label={kitchen.name}
                                decorative
                                flush
                                className="h-full w-full"
                            />
                        </View>
                        <View className="flex-1 flex-col justify-end p-[26px]">
                            <View className="h-[76px] w-[76px] overflow-hidden rounded-[22px] border-4 border-surface-raised">
                                <EntityImage
                                    assetId={kitchen.imagePlaceholderId}
                                    seed={`${kitchen.slug}-logo`}
                                    label={kitchen.name}
                                    decorative
                                    flush
                                    className="h-full w-full"
                                />
                            </View>
                            {today === undefined ? null : (
                                <View className="mt-3.5 h-7 flex-row items-center gap-1.5 self-start rounded-full bg-surface-raised px-2.5">
                                    <View
                                        className={cx(
                                            'h-2 w-2 rounded-full',
                                            today === null ? 'bg-stroke' : 'bg-surface-brand',
                                        )}
                                    />
                                    <RNText className="text-xs font-bold uppercase tracking-wide text-content-primary">
                                        {todayLabel(today, t)}
                                    </RNText>
                                </View>
                            )}
                            <RNText
                                role="heading"
                                aria-level={2}
                                className="mt-2.5 font-display text-3xl font-bold leading-tight text-content-on-canopy text-start"
                            >
                                {kitchen.name}
                            </RNText>
                            <RNText className="mt-1.5 text-sm text-content-on-canopy-muted text-start">
                                {kitchenWhere(kitchen, t)}
                            </RNText>
                            <View className="mt-[18px] flex-row gap-1.5">
                                {[
                                    { key: 'items', value: tallies.items, label: 'cardItems' },
                                    { key: 'areas', value: tallies.areas, label: 'cardAreas' },
                                    { key: 'plans', value: tallies.plans, label: 'cardPlans' },
                                ].map((cell) => (
                                    <View
                                        key={cell.key}
                                        className="flex-1 flex-col items-center rounded-[14px] bg-content-on-canopy/10 px-0.5 py-2"
                                    >
                                        <RNText className="font-display text-lg font-bold tabular-nums text-content-on-canopy">
                                            {cell.value ?? dash}
                                        </RNText>
                                        <RNText className="text-xs font-semibold uppercase tracking-wide text-content-on-canopy-muted">
                                            {t(`marketplace:kitchens.${cell.label}`)}
                                        </RNText>
                                    </View>
                                ))}
                            </View>
                        </View>
                    </View>

                    <View className="relative flex-1 flex-col p-[26px]">
                        <Pressable
                            testID={`${testID}-close`}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('marketplace:kitchens.close')}
                            onPress={onClose}
                            className="absolute end-4 top-4 h-11 w-11 items-center justify-center rounded-full bg-surface-base hover:bg-surface-sunken"
                        >
                            <Icon name="close" className="text-content-primary" />
                        </Pressable>

                        {kitchen.deliveryWindows.length === 0 ? null : (
                            <>
                                <Label>{t('marketplace:kitchens.windowsToday')}</Label>
                                <View className="mt-2.5 flex-row flex-wrap gap-2 pe-12">
                                    {kitchen.deliveryWindows.map((window, index) => {
                                        const tint =
                                            WINDOW_TINTS[index % WINDOW_TINTS.length] ?? 'green';
                                        return (
                                            <View
                                                key={window.code}
                                                className={cx(
                                                    'min-w-[150px] flex-1 basis-[45%] flex-col rounded-[14px] px-3 py-2.5',
                                                    TINT_FILL[tint],
                                                )}
                                            >
                                                <RNText
                                                    className={cx(
                                                        'font-display text-sm font-bold',
                                                        TINT_INK[tint],
                                                    )}
                                                >
                                                    {window.label}
                                                </RNText>
                                                <RNText
                                                    className={cx(
                                                        'text-sm tabular-nums',
                                                        TINT_INK[tint],
                                                    )}
                                                >
                                                    {t('marketplace:discover.slotTime', {
                                                        start: window.startsAt,
                                                        end: window.endsAt,
                                                    })}
                                                </RNText>
                                            </View>
                                        );
                                    })}
                                </View>
                            </>
                        )}

                        {tallies.dishes.length === 0 ? null : (
                            <>
                                <Label className="mt-5">
                                    {t('marketplace:kitchens.popularHere')}
                                </Label>
                                <View className="mt-2.5 flex-row gap-2.5">
                                    {tallies.dishes.map((dish) => (
                                        <View
                                            key={dish.id}
                                            className="h-24 w-24 overflow-hidden rounded-[18px]"
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
                            </>
                        )}

                        {tags.length === 0 ? null : (
                            <>
                                <Label className="mt-5">{t('marketplace:kitchens.knownFor')}</Label>
                                <View className="mt-2.5 flex-row flex-wrap gap-1.5">
                                    {tags.map((tag) => (
                                        <View
                                            key={tag.label}
                                            className={cx(
                                                'h-7 justify-center rounded-full px-2.5',
                                                TINT_FILL[tag.tint],
                                            )}
                                        >
                                            <RNText
                                                className={cx(
                                                    'text-xs font-semibold',
                                                    TINT_INK[tag.tint],
                                                )}
                                            >
                                                {tag.label}
                                            </RNText>
                                        </View>
                                    ))}
                                </View>
                            </>
                        )}

                        <View className="mt-5 flex-row flex-wrap items-center gap-x-3 gap-y-1">
                            {facts === null ? null : (
                                <RNText
                                    testID={`${cardTestID}-facts`}
                                    className="text-sm text-content-secondary text-start"
                                >
                                    {facts}
                                </RNText>
                            )}
                            {kitchen.rating === null ? (
                                <RNText
                                    testID={`${cardTestID}-unrated`}
                                    className="text-sm text-content-secondary"
                                >
                                    {t('marketplace:kitchens.notRatedYet')}
                                </RNText>
                            ) : (
                                <RNText
                                    testID={`${cardTestID}-rating`}
                                    className="text-sm font-semibold tabular-nums text-content-primary"
                                >
                                    {t('marketplace:kitchens.ratingShort', {
                                        rating: formatter.formatNumber(kitchen.rating, {
                                            minimumFractionDigits: 1,
                                            maximumFractionDigits: 1,
                                        }),
                                        count: kitchen.ratingCount,
                                    })}
                                </RNText>
                            )}
                        </View>

                        <View className="mt-auto flex-row gap-2.5 pt-5">
                            <Pressable
                                testID={`${testID}-keep`}
                                role="button"
                                accessibilityRole="button"
                                onPress={onClose}
                                className="h-[54px] items-center justify-center rounded-2xl border border-stroke px-[18px] hover:border-surface-brand"
                            >
                                <RNText className="text-sm font-semibold text-content-primary">
                                    {t('marketplace:kitchens.keepBrowsing')}
                                </RNText>
                            </Pressable>
                            <Pressable
                                testID={`${testID}-open`}
                                role="link"
                                accessibilityRole="link"
                                onPress={onOpenKitchen}
                                className="h-[54px] flex-1 flex-row items-center justify-between rounded-2xl bg-surface-brand px-5 hover:bg-surface-canopy"
                            >
                                <RNText className="text-base font-bold text-content-on-brand">
                                    {t('marketplace:kitchens.openKitchenShort')}
                                </RNText>
                                <Icon name="chevronForward" className="text-content-on-brand" />
                            </Pressable>
                        </View>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

/** The board's small upper-case label over each part. */
function Label({
    children,
    className,
}: {
    readonly children: string;
    readonly className?: string | undefined;
}) {
    return (
        <RNText
            className={cx(
                'text-xs font-bold uppercase tracking-widest text-content-secondary text-start',
                className,
            )}
        >
            {children}
        </RNText>
    );
}
