import { Rating, Text } from '@healthy360/design-system';
import type { TagRowItem } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useTranslation } from 'react-i18next';

import { EntityImage, MediaChip } from '../../media/entity-image.tsx';
import { BrowseCard } from '../../ui/browse-card.tsx';
import { formatMoney } from './format.ts';

/**
 * One kitchen, as it appears in a list.
 *
 * The shape is {@link BrowseCard} — HealthZone's browse card, drawn once and shared with the meal
 * card. What is left here is the mapping: which field of `Kitchen` belongs in which slot, and what
 * each slot says when the field is empty.
 *
 * ## Every slot is fed by something the API actually returns
 *
 * The design draws a card full of confident copy: a pick of the day, a signature dish, a rating on
 * every kitchen. `MarketplaceKitchenPresenter` publishes `tagline: ''`, `cuisines: []`,
 * `rating: null` and `is_verified: false` today; what it *does* publish is the name, the slug the
 * photograph is keyed on, the diet classifications derived from the kitchen's own meals, and the
 * branches with their delivery zones. So:
 *
 * - the mark over the photograph appears only for a kitchen that really is verified, and a card
 *   without one is the normal case rather than a gap;
 * - the prose line falls back from the tagline to the areas the kitchen trades in, which is a real
 *   fact about it rather than filler;
 * - an unrated kitchen says so **on the title's baseline**, where the rating would have been,
 *   rather than on a line of its own — four stacked scraps of small text is what that cost;
 * - the tags are the kitchen's diet classifications, falling back to the channels it sells
 *   through — the same vocabulary the directory's own filter chips use, so a lit chip and the card
 *   that answered it say the same word.
 *
 * ## The delivery figures are a hint, not a promise
 *
 * The first branch's first zone, as advertised. The copy says "about", and checking whether *this*
 * person's address is covered is a subscription-flow decision (doc 17, SUB-02) that happens before
 * a price rather than on a card. A kitchen that publishes no zone says that too — the absence is
 * the information, and it is why the footer never collapses to nothing.
 */
export interface KitchenCardProps {
    readonly kitchen: Kitchen;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

/** How many tags fit on one line of a grid cell before the row wraps and unbalances the card. */
const MAX_TAGS = 3;

export function KitchenCard({ kitchen, onPress, testID }: KitchenCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const branch = kitchen.branches[0];
    const zone = branch?.deliveryZones[0];
    const resolvedTestID = testID ?? `kitchen-card-${kitchen.slug}`;

    /*
     * De-duplicated, because two branches in one district is a normal configuration and
     * "Jumeirah 1 · Jumeirah 1" reads as a fault in the data rather than as two branches.
     */
    const areas = [
        ...new Set(kitchen.branches.map((each) => each.area).filter((area) => area !== '')),
    ];
    const summary =
        kitchen.tagline.trim() === ''
            ? areas.join(t('marketplace:kitchens.areaSeparator'))
            : kitchen.tagline;

    const tags: readonly TagRowItem[] =
        kitchen.dietClassifications.length === 0
            ? [
                  ...(kitchen.channels.delivery
                      ? [{ key: 'delivery', label: t('marketplace:channels.delivery') }]
                      : []),
                  ...(kitchen.channels.pickup
                      ? [{ key: 'pickup', label: t('marketplace:channels.pickup') }]
                      : []),
                  ...(kitchen.channels.subscription
                      ? [{ key: 'subscription', label: t('marketplace:channels.subscription') }]
                      : []),
              ]
            : kitchen.dietClassifications.map((diet) => ({
                  key: diet,
                  label: t(`marketplace:diets.${diet}`),
              }));

    const feeLine =
        zone === undefined || zone.deliveryFee === null
            ? undefined
            : zone.deliveryFee.amount === 0
              ? t('marketplace:kitchens.freeDelivery')
              : t('marketplace:kitchens.deliveryFee', {
                    fee: formatMoney(formatter, zone.deliveryFee),
                });

    const timeLine =
        zone === undefined
            ? branch?.supportsPickup === true
                ? t('marketplace:kitchens.collectionOnly')
                : t('marketplace:kitchens.noPublishedZone')
            : zone.estimatedMinutes === null
              ? t('marketplace:kitchens.deliversTo', { area: zone.area })
              : t('marketplace:kitchens.etaMinutes', { minutes: zone.estimatedMinutes });

    return (
        <BrowseCard
            testID={resolvedTestID}
            onPress={onPress}
            accessibilityLabel={t('marketplace:kitchens.cardLabel', { kitchen: kitchen.name })}
            media={
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
                            <MediaChip
                                testID={`${resolvedTestID}-verified`}
                                label={t('marketplace:kitchens.verified')}
                            />
                        ) : undefined
                    }
                />
            }
            title={kitchen.name}
            trailing={
                kitchen.rating === null ? (
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
                        compact
                    />
                )
            }
            meta={summary}
            tags={tags}
            maxTags={MAX_TAGS}
            facts={{
                start: timeLine,
                startTestID: `${resolvedTestID}-zone`,
                ...(feeLine === undefined
                    ? {}
                    : { end: feeLine, endTestID: `${resolvedTestID}-fee` }),
            }}
        />
    );
}
