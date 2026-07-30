import {
    Badge,
    Card,
    Chip,
    ImagePlaceholder,
    Inline,
    Rating,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';

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

    return (
        <Card
            testID={resolvedTestID}
            padding="none"
            tone="raised"
            onPress={onPress}
            accessibilityLabel={t('marketplace:kitchens.cardLabel', { kitchen: kitchen.name })}
        >
            <ImagePlaceholder
                testID={`${resolvedTestID}-image`}
                seed={kitchen.slug}
                label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                aspect="wide"
            />

            <Stack space="sm" className="p-4">
                <Stack space="xs">
                    <Inline space="xs" align="center">
                        <Text variant="bodyStrong">{kitchen.name}</Text>
                        {kitchen.isVerified ? (
                            <Badge
                                testID={`${resolvedTestID}-verified`}
                                tone="success"
                                label={t('marketplace:kitchens.verified')}
                            />
                        ) : null}
                    </Inline>
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

                {zone === undefined ? null : (
                    <Text testID={`${resolvedTestID}-zone`} tone="secondary" variant="caption">
                        {zone.estimatedMinutes === null
                            ? t('marketplace:kitchens.deliversTo', { area: zone.area })
                            : t('marketplace:kitchens.deliversToTimed', {
                                  area: zone.area,
                                  minutes: zone.estimatedMinutes,
                              })}
                    </Text>
                )}
            </Stack>
        </Card>
    );
}
