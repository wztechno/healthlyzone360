import { Icon, cx } from '@healthy360/design-system';
import type { SubscriptionPlan } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { ShopStateCard } from '../../../ui/shop-state.tsx';
import { cheapestVariant } from '../../catalogue/plan-catalogue.ts';
import { TINT_FILL, TINT_INK } from '../../catalogue/shelf-tints.ts';
import type { ShelfTint } from '../../catalogue/shelf-tints.ts';
import { formatMoney } from '../format.ts';
import { useShopViewOnly } from '../shop-view-only.tsx';

/** The plans' icon tiles, in turn. */
const PLAN_TINTS: readonly ShelfTint[] = ['green', 'violet', 'orange', 'blue'];

/**
 * The storefront's Plans tab, as the accepted shop board draws it: "How plans work", then the
 * kitchen's plans three across, each a card with its icon tile, name and summary, its price and
 * "Start this plan".
 *
 * ## The price is per week, from the cheapest size
 *
 * A plan variant publishes a weekly price and nothing that says how many deliveries a week buys, so
 * the card states the weekly price of the cheapest variant, prefixed "from" — the same figure, and
 * the same refusal to advertise from one size and show another, as the `/plans` catalogue
 * (`plan-catalogue.ts`, `cheapestVariant`).
 *
 * ## No plans
 *
 * A kitchen that sells none gets the board's dashed empty card, saying so.
 */
export interface StorefrontPlansTabProps {
    readonly kitchenName: string;
    readonly plans: readonly SubscriptionPlan[];
    readonly onChoose: (plan: SubscriptionPlan) => void;
    readonly onHowPlansWork: () => void;
}

export function StorefrontPlansTab({
    kitchenName,
    plans,
    onChoose,
    onHowPlansWork,
}: StorefrontPlansTabProps) {
    const viewOnly = useShopViewOnly();
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View testID="kitchen-plans-tab" className="flex-col gap-4">
            <View className="flex-row flex-wrap items-baseline justify-between gap-3">
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-xl font-bold text-content-primary text-start"
                >
                    {t('marketplace:storefront.plans.title', { kitchen: kitchenName })}
                </RNText>
                <Pressable
                    testID="kitchen-plans-how"
                    role="link"
                    accessibilityRole="link"
                    onPress={onHowPlansWork}
                    className="min-h-touch flex-row items-center gap-1 rounded-full px-2 hover:bg-surface-brand-subtle"
                >
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                        {t('marketplace:storefront.plans.howItWorks')}
                    </RNText>
                    <Icon name="chevronEnd" size="sm" className="text-content-on-brand-subtle" />
                </Pressable>
            </View>

            {plans.length === 0 ? (
                // Shop · Kitchens + storefront, pin 9: the small state card, its sentence as title.
                <ShopStateCard
                    testID="kitchen-plans-empty"
                    small
                    icon="calendarDays"
                    title={t('marketplace:storefront.plans.empty')}
                />
            ) : (
                <View className="flex-row flex-wrap gap-4">
                    {plans.map((plan, index) => {
                        const cheapest = cheapestVariant(plan);
                        const tint = PLAN_TINTS[index % PLAN_TINTS.length] ?? 'green';
                        return (
                            <View
                                key={plan.id}
                                testID={`kitchen-plan-${plan.slug}`}
                                className="min-w-[220px] flex-1 basis-[30%] flex-col gap-2.5 rounded-3xl border border-stroke-subtle bg-surface-raised p-5"
                            >
                                <View
                                    className={cx(
                                        'h-11 w-11 items-center justify-center rounded-[14px]',
                                        TINT_FILL[tint],
                                    )}
                                >
                                    <Icon
                                        name="calendarDays"
                                        size="sm"
                                        className={TINT_INK[tint]}
                                    />
                                </View>
                                <RNText className="font-display text-lg font-bold text-content-primary text-start">
                                    {plan.name}
                                </RNText>
                                <RNText
                                    numberOfLines={2}
                                    className="text-sm text-content-secondary text-start"
                                >
                                    {plan.summary === ''
                                        ? t('marketplace:storefront.plans.youPick')
                                        : plan.summary}
                                </RNText>
                                {cheapest === null ? null : (
                                    <View className="mt-auto flex-row items-baseline gap-1.5 pt-1">
                                        <RNText
                                            testID={`kitchen-plan-${plan.slug}-price`}
                                            className="font-display text-2xl font-bold tabular-nums text-content-primary"
                                        >
                                            {t('marketplace:storefront.order.fromAmount', {
                                                amount: formatMoney(
                                                    formatter,
                                                    cheapest.pricePerWeek,
                                                ),
                                            })}
                                        </RNText>
                                        <RNText className="text-sm text-content-secondary">
                                            {t('marketplace:storefront.plans.perWeek')}
                                        </RNText>
                                    </View>
                                )}
                                <Pressable
                                    testID={`kitchen-plan-${plan.slug}-choose`}
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={t(
                                        'marketplace:storefront.plans.chooseLabel',
                                        {
                                            plan: plan.name,
                                        },
                                    )}
                                    onPress={() => {
                                        onChoose(plan);
                                    }}
                                    className="mt-1 h-[52px] items-center justify-center rounded-2xl bg-surface-brand hover:bg-surface-canopy"
                                >
                                    <RNText className="text-base font-bold text-content-on-brand">
                                        {viewOnly
                                            ? t('catalogue:plans.viewPlanShort')
                                            : t('marketplace:storefront.plans.start')}
                                    </RNText>
                                </Pressable>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
}
