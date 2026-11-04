import type { Kitchen, MarketplaceMeal } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import { mealsFromPages, useMealsQuery, usePlansQuery } from '../../data/catalogue-hooks.ts';
import type { ShelfTint } from '../catalogue/shelf-tints.ts';
import { shownItemTypes } from '../catalogue/shown-shelves.ts';
import { formatMoney } from './format.ts';
import { publishesHours } from './kitchen-finder.ts';
import { deliveryTerms, fastestDeliveryMinutes, hoursToday } from './storefront-facts.ts';

/**
 * What the kitchen finder's card and its Quick look say about a kitchen: today's hours, its
 * delivery terms, where it cooks, what it is known for, and its counted items, areas and plans.
 */

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

/** Where it cooks — its first trading branch and that branch's area. */
export function kitchenWhere(kitchen: Kitchen, t: TFunction): string {
    const branch = kitchen.branches.find((candidate) => candidate.isActive) ?? kitchen.branches[0];
    if (branch === undefined) return '';
    return [branch.name, branch.area]
        .filter((part) => part.trim() !== '')
        .join(t('marketplace:kitchens.whereSeparator'));
}

/** The zones its trading branches deliver to. */
export function kitchenAreas(kitchen: Kitchen): number {
    return kitchen.branches
        .filter((branch) => branch.isActive)
        .reduce((sum, branch) => sum + branch.deliveryZones.length, 0);
}

/** The tag colours, in turn. */
const TAG_TINTS: readonly ShelfTint[] = ['green', 'orange', 'blue', 'violet'];

/** What the kitchen is known for: its diets (not "omnivore") and cuisines, three at most. */
export function kitchenTags(
    kitchen: Kitchen,
    t: TFunction,
): readonly { readonly label: string; readonly tint: ShelfTint }[] {
    return [
        ...kitchen.dietClassifications
            .filter((diet) => diet !== 'omnivore')
            .map((diet) => t(`marketplace:diets.${diet}`)),
        ...kitchen.cuisines,
    ]
        .slice(0, 3)
        .map((label, index) => ({ label, tint: TAG_TINTS[index % TAG_TINTS.length] ?? 'green' }));
}

export interface KitchenTallies {
    /** "99", "100+", or `null` while not known. */
    readonly items: string | null;
    readonly plans: string | null;
    readonly areas: string;
    /** Up to three of its dishes with photographs, best first. */
    readonly dishes: readonly MarketplaceMeal[];
}

/** The card's and Quick look's counts and dishes, from the kitchen's own listings. */
export function useKitchenTallies(kitchen: Kitchen): KitchenTallies {
    const formatter = useFormatter();
    const meals = useMealsQuery({
        kitchenIds: [kitchen.id],
        itemTypes: shownItemTypes(['meal']),
        sort: 'rating',
        limit: 100,
    });
    // A kitchen that sells no plans is not asked for any: it has none.
    const sellsPlans = kitchen.channels.subscription;
    const plans = usePlansQuery({ kitchenIds: [kitchen.id], limit: 50 }, sellsPlans);
    const listed = mealsFromPages(meals.data?.pages);
    const planCount = plans.data?.items.length;

    return {
        items:
            meals.data === undefined
                ? null
                : `${formatter.formatNumber(listed.length)}${meals.hasNextPage ? '+' : ''}`,
        plans: !sellsPlans
            ? formatter.formatNumber(0)
            : planCount === undefined
              ? null
              : formatter.formatNumber(planCount),
        areas: formatter.formatNumber(kitchenAreas(kitchen)),
        dishes: listed.slice(0, 3),
    };
}
