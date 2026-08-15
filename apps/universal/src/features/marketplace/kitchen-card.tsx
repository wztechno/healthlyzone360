import { Badge, Card, Chip, Inline, Rating, Stack, Text } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';

import { Text as RNText, View } from 'react-native';

import { EntityImage, MediaChip } from '../../media/entity-image.tsx';

/**
 * One kitchen, as it appears in a list.
 *
 * ## Channels are shown, not summarised
 *
 * A kitchen's eight sales-channel switches are the difference between "you can have this delivered
 * tonight" and "you can collect it at a counter in Al Quoz", and the reference research found both
 * products hiding that until checkout (doc 11). So delivery, collection and subscription each get
 * their own badge, driven directly by `channels`, and a kitchen with none of them simply shows
 * none — the absence is the information.
 *
 * ## The delivery hint
 *
 * The first branch's first delivery zone, named, with its advertised time when the kitchen
 * publishes one. It is deliberately not a promise: the copy says "delivers to", not "delivers in",
 * and the zone is a label rather than a geometry. Checking whether *this* person's address is
 * covered is a subscription-flow decision (doc 17, SUB-02) and it happens before a price, not on a
 * card.
 */
export interface KitchenCardProps {
    readonly kitchen: Kitchen;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export function KitchenCard({ kitchen, onPress, testID }: KitchenCardProps) {
    const { t } = useTranslation();

    const branch = kitchen.branches[0];
    const zone = branch?.deliveryZones[0];
    const resolvedTestID = testID ?? `kitchen-card-${kitchen.slug}`;

    const footer = (
        <View className="flex-col gap-2 border-t border-surface-sunken px-4 pb-4 pt-3">
            <Inline space="xs" wrap testID={`${resolvedTestID}-channels`}>
                {kitchen.channels.delivery ? (
                    <Badge tone="info" label={t('marketplace:channels.delivery')} />
                ) : null}
                {kitchen.channels.pickup ? (
                    <Badge tone="info" label={t('marketplace:channels.pickup')} />
                ) : null}
                {kitchen.channels.subscription ? (
                    <Badge tone="info" label={t('marketplace:channels.subscription')} />
                ) : null}
            </Inline>

            {/*
             * A minimum height whether or not a zone is published, so a kitchen that names none
             * does not pull its neighbour's channels out of line across the row.
             */}
            <Text
                testID={`${resolvedTestID}-zone`}
                tone="secondary"
                variant="caption"
                numberOfLines={1}
                className="min-h-[18px]"
            >
                {zone === undefined
                    ? t('marketplace:kitchens.noPublishedZone')
                    : zone.estimatedMinutes === null
                      ? t('marketplace:kitchens.deliversTo', { area: zone.area })
                      : t('marketplace:kitchens.deliversToTimed', {
                            area: zone.area,
                            minutes: zone.estimatedMinutes,
                        })}
            </Text>
        </View>
    );

    return (
        <Card
            testID={resolvedTestID}
            padding="none"
            tone="raised"
            interactive
            onPress={onPress}
            footer={footer}
            // Fills the grid cell, so a kitchen with two cuisine chips ends level with the one
            // beside it that has five. `Card`'s `self-stretch` only ever governed the width; see
            // the note on the same class in `meal-card.tsx`.
            className="grow"
            accessibilityLabel={t('marketplace:kitchens.cardLabel', { kitchen: kitchen.name })}
        >
            <EntityImage
                testID={`${resolvedTestID}-image`}
                assetId={kitchen.imagePlaceholderId}
                variant="card"
                seed={kitchen.slug}
                label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                aspect="card"
                flush
                overlayStart={
                    kitchen.isVerified ? (
                        <MediaChip label={t('marketplace:kitchens.verified')} />
                    ) : undefined
                }
            />

            <Stack space="sm" className="px-4 pt-4">
                <Stack space="xs">
                    <RNText
                        testID={`${resolvedTestID}-verified`}
                        numberOfLines={2}
                        className="font-display text-lg leading-tight text-content-primary text-start"
                    >
                        {kitchen.name}
                    </RNText>
                    <Text tone="secondary" variant="caption">
                        {kitchen.tagline}
                    </Text>
                </Stack>

                {kitchen.rating === null ? (
                    <Text testID={`${resolvedTestID}-unrated`} tone="secondary" variant="caption">
                        {t('marketplace:kitchens.notRatedYet')}
                    </Text>
                ) : (
                    <Rating
                        testID={`${resolvedTestID}-rating`}
                        label={t('marketplace:kitchens.ratingLabel', { kitchen: kitchen.name })}
                        value={kitchen.rating}
                        count={kitchen.ratingCount}
                        size="sm"
                    />
                )}

                <Inline space="xs" wrap testID={`${resolvedTestID}-cuisines`}>
                    {kitchen.cuisines.map((cuisine) => (
                        <Chip key={cuisine} label={cuisine} tone="neutral" />
                    ))}
                </Inline>
            </Stack>
        </Card>
    );
}
