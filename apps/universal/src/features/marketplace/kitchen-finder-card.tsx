import { Rating, Text } from '@healthy360/design-system';
import type { Kitchen } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EntityImage, MediaChip } from '../../media/entity-image.tsx';
import { BrowseCard } from '../../ui/browse-card.tsx';
import { formatMoney } from './format.ts';
import { publishesHours } from './kitchen-finder.ts';
import { deliveryTerms, fastestDeliveryMinutes, hoursToday } from './storefront-facts.ts';

/**
 * One kitchen in the `/kitchens` finder: photograph, name, rating, where it cooks, and one line of
 * delivery terms. The whole card is the link to the kitchen — the storefront is where the menu,
 * the plans and the basket live, so the card carries no controls of its own.
 *
 * Built on {@link BrowseCard}, as `KitchenCard` is; the two differ only in what they say. This one
 * states today's published hours over the photograph and the fee and minimum in its footer, which
 * is what the finder's own filters and sorts are about.
 *
 * - **"OPEN · UNTIL 21:30".** "Open" is a claim about this instant in the kitchen's time zone, which
 *   `storefront-facts.ts` explains cannot be made reliably on native. The chip states today's
 *   published window instead, and is absent for a kitchen that publishes no hours at all.
 * - **A figure the kitchen does not publish** is left out of the line rather than drawn as a dash.
 */
export interface KitchenFinderCardProps {
    readonly kitchen: Kitchen;
    readonly testID?: string | undefined;
}

/** Today's published window, `null` when closed today, `undefined` when no hours are published. */
export function todayWindow(kitchen: Kitchen) {
    return publishesHours(kitchen) ? hoursToday(kitchen) : undefined;
}

/** The status chip's text — "Open today · 09:00–22:00" / "Closed today". */
export function todayLabel(window: ReturnType<typeof hoursToday>, t: TFunction): string {
    return window === null
        ? t('marketplace:kitchens.finder.closedToday')
        : t('marketplace:kitchens.finder.openToday', {
              opensAt: window.opensAt,
              closesAt: window.closesAt,
          });
}

/**
 * Delivery time, fee and minimum order as one line — "30 min · AED 5.00 fee · Min AED 50.00".
 *
 * The lowest figure across the kitchen's zones, said as "from" when zones differ, as the storefront
 * states it. `null` when the kitchen publishes none of the three.
 */
export function kitchenFacts(kitchen: Kitchen, formatter: Formatter, t: TFunction): string | null {
    const terms = deliveryTerms(kitchen);
    const minutes = fastestDeliveryMinutes(kitchen);
    const parts: string[] = [];

    if (minutes !== null) {
        parts.push(
            t('marketplace:kitchens.finder.minutes', { minutes: formatter.formatNumber(minutes) }),
        );
    }
    if (terms.deliveryFee !== null) {
        const amount = formatMoney(formatter, terms.deliveryFee);
        parts.push(
            terms.deliveryFee.amount === 0 && !terms.varies
                ? t('marketplace:kitchens.freeDelivery')
                : terms.varies
                  ? t('marketplace:kitchens.finder.feeFrom', { amount })
                  : t('marketplace:kitchens.finder.fee', { amount }),
        );
    }
    if (terms.minimumOrder !== null) {
        const amount = formatMoney(formatter, terms.minimumOrder);
        parts.push(
            terms.varies
                ? t('marketplace:kitchens.finder.minimumFrom', { amount })
                : t('marketplace:kitchens.finder.minimum', { amount }),
        );
    }

    return parts.length === 0 ? null : parts.join(t('marketplace:kitchens.areaSeparator'));
}

/** The line under the name: cuisines (else the tagline), then the area it trades from. */
export function kitchenSummary(kitchen: Kitchen, t: TFunction): string {
    const separator = t('marketplace:kitchens.areaSeparator');
    const what =
        kitchen.cuisines.length > 0 ? kitchen.cuisines.join(separator) : kitchen.tagline.trim();
    const area = kitchen.branches.find((branch) => branch.isActive && branch.area !== '')?.area;
    return [what, area ?? ''].filter((part) => part !== '').join(separator);
}

export function KitchenFinderCard({ kitchen, testID }: KitchenFinderCardProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const id = testID ?? `kitchen-card-${kitchen.slug}`;

    const today = todayWindow(kitchen);
    const facts = kitchenFacts(kitchen, formatter, t);
    const chips =
        today === undefined && !kitchen.isVerified ? undefined : (
            <View className="flex-row gap-1.5">
                {today === undefined ? null : (
                    <MediaChip testID={`${id}-today`} label={todayLabel(today, t)} />
                )}
                {kitchen.isVerified ? (
                    <MediaChip
                        testID={`${id}-verified`}
                        label={t('marketplace:kitchens.verified')}
                    />
                ) : null}
            </View>
        );

    return (
        <BrowseCard
            testID={id}
            onPress={() => {
                router.push(`/kitchens/${String(kitchen.id)}` as never);
            }}
            accessibilityLabel={t('marketplace:kitchens.cardLabel', { kitchen: kitchen.name })}
            className="flex-1"
            media={
                <EntityImage
                    testID={`${id}-image`}
                    assetId={kitchen.imagePlaceholderId}
                    variant="card"
                    seed={kitchen.slug}
                    label={t('marketplace:kitchens.imageLabel', { kitchen: kitchen.name })}
                    aspect="card"
                    decorative
                    flush
                    overlayStart={chips}
                />
            }
            title={kitchen.name}
            titleLines={1}
            trailing={
                kitchen.rating === null ? (
                    <Text testID={`${id}-unrated`} tone="secondary" variant="caption">
                        {t('marketplace:kitchens.notRatedYet')}
                    </Text>
                ) : (
                    <Rating
                        testID={`${id}-rating`}
                        label={t('marketplace:kitchens.ratingLabel', { kitchen: kitchen.name })}
                        value={kitchen.rating}
                        count={kitchen.ratingCount}
                        size="sm"
                        compact
                    />
                )
            }
            meta={kitchenSummary(kitchen, t)}
            metaLines={1}
            {...(facts === null ? {} : { facts: { start: facts, startTestID: `${id}-facts` } })}
        />
    );
}
