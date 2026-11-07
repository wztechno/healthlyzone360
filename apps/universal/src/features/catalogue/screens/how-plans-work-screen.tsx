import { Collapse, Icon, cx } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, View } from 'react-native';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { useNavigateUp } from '../../../navigation/use-return-to.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PlanBalanceCalculator } from '../plan-balance-calculator.tsx';

/**
 * `/plans/how-it-works` — the accepted "How plans work" board: "Weekly plans" back, the title beside
 * the canopy example balance, the six rules, the balance calculator, the cut-off timeline beside the
 * plan states, the questions people ask, and the closing canopy band.
 *
 * ## Every rule is the platform's, checked against it
 *
 * The design's model — "a plan is a balance of delivery days, not a calendar" — is the approved S1
 * semantics (`docs/s1-subscription-semantics-proposal.md`, D-077), and the backend implements it:
 * `subscriptions.balance_days_total` / `balance_days_consumed` and a captured per-day price. The copy
 * keeps the design's sentences and follows the implementation where the drawing says more than it
 * does:
 *
 * - **Balances are 7, 14, 28 or 84 days**, the closed duration vocabulary, not 10/20/30.
 * - **The cut-off is the plan's, not a constant.** `change_cutoff_hours` defaults to 24 and a
 *   kitchen may set another, so the rules say "24 hours before, unless the plan sets its own".
 * - **A day is used when the order is created**, at the cut-off, not on delivery
 *   (`GenerationService`); a kitchen-cancelled order gives the day back.
 * - **Skips and pauses are the plan's to allow** (`skip_allowed`, `pause_allowed`), and a skip is
 *   one delivery, not a week.
 * - **A cancellation promises no money.** A subscription is paid per delivery, so nothing is held
 *   and nothing is credited back.
 * - **"No swaps — skip instead"** is a per-subscription switch the API accepts and this app does
 *   not yet offer, so the FAQ does not offer it either.
 * - **Choosing each meal** is a plan's `allows_free_selection`, not a right on every plan.
 * - **Address and window are the subscription's**, changed for the deliveries outside the cut-off
 *   rather than for one delivery.
 *
 * ## The example panel is labelled as one
 *
 * The canopy card beside the title illustrates the model — "an example 14-day balance" — so its
 * two footer figures state rules rather than a price and a date somebody could mistake for an offer.
 */

/** The example balance drawn in the hero: a 14-day run, nine of them delivered. */
const EXAMPLE_DAYS = 14;
const EXAMPLE_DELIVERED = 9;
const EXAMPLE_COLUMNS = 7;

/** The calculator's anchor, for the hero's "Try the balance calculator" on the web. */
const CALCULATOR_ID = 'plans-balance-calculator';

const RULE_KEYS = ['days', 'skip', 'cutoff', 'price', 'allergies', 'cancel'] as const;
const CUTOFF_STEPS = ['lock', 'order', 'delivered'] as const;
const STATES: readonly { readonly key: string }[] = [
    { key: 'active' },
    { key: 'paused' },
    { key: 'completed' },
    { key: 'cancelled' },
];
const FAQ_KEYS = ['soldOut', 'chooseMeals', 'expire', 'address', 'priceRise'] as const;

/** A section's title, as the board sets them: display type over the cards. */
function SectionTitle({ title, testID }: { readonly title: string; readonly testID: string }) {
    return (
        <RNText
            testID={testID}
            accessibilityRole="header"
            aria-level={2}
            className="mb-4 font-display text-3xl font-bold tracking-display text-content-primary text-start"
        >
            {title}
        </RNText>
    );
}

/** The canopy example beside the title: a 14-day balance as numbered cells, some delivered. */
function BalanceExample() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const remaining = EXAMPLE_DAYS - EXAMPLE_DELIVERED;
    const rows = Array.from({ length: EXAMPLE_DAYS / EXAMPLE_COLUMNS }, (_, row) =>
        Array.from({ length: EXAMPLE_COLUMNS }, (_, column) => row * EXAMPLE_COLUMNS + column),
    );

    return (
        <View
            testID="how-plans-example"
            className="relative min-w-[280px] overflow-hidden rounded-[26px] bg-surface-canopy p-[22px] lg:w-[440px]"
        >
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-[120px] -top-[140px] h-[380px] w-[380px] rounded-full bg-stage-green opacity-15"
            />
            <RNText className="text-xs font-bold uppercase tracking-wider text-content-on-canopy-muted">
                {t('catalogue:howPlans.example.eyebrow', {
                    days: formatter.formatNumber(EXAMPLE_DAYS),
                })}
            </RNText>
            <RNText
                testID="how-plans-example-left"
                className="mt-1.5 font-display text-3xl font-bold tracking-display text-content-on-canopy text-start"
            >
                {t('catalogue:howPlans.example.left', { count: remaining })}
            </RNText>
            <RNText className="mt-0.5 text-sm font-medium text-content-on-canopy-muted text-start">
                {t('catalogue:howPlans.example.body', {
                    delivered: formatter.formatNumber(EXAMPLE_DELIVERED),
                })}
            </RNText>
            <View
                accessibilityRole="image"
                accessibilityLabel={t('catalogue:howPlans.example.gridLabel', {
                    delivered: formatter.formatNumber(EXAMPLE_DELIVERED),
                    remaining: formatter.formatNumber(remaining),
                })}
                className="my-[18px] flex-col gap-2"
            >
                {rows.map((row) => (
                    <View key={row[0]} className="flex-row gap-2">
                        {row.map((cell) => {
                            const delivered = cell < EXAMPLE_DELIVERED;
                            return (
                                <View
                                    key={cell}
                                    className={cx(
                                        'h-[38px] min-w-0 flex-1 items-center justify-center rounded-xl',
                                        delivered
                                            ? 'bg-surface-brand-subtle'
                                            : 'border border-dashed border-content-on-canopy/30 bg-content-on-canopy/10',
                                    )}
                                >
                                    <RNText
                                        className={cx(
                                            'text-xs font-bold tabular-nums',
                                            delivered
                                                ? 'text-content-on-brand-subtle'
                                                : 'text-content-on-canopy-muted',
                                        )}
                                    >
                                        {formatter.formatNumber(cell + 1)}
                                    </RNText>
                                </View>
                            );
                        })}
                    </View>
                ))}
            </View>
            <View className="flex-row gap-2.5">
                {(['price', 'skips'] as const).map((fact) => (
                    <View
                        key={fact}
                        className="min-w-0 flex-1 rounded-[14px] bg-content-on-canopy/10 px-3 py-2.5"
                    >
                        <RNText className="text-xs font-medium text-content-on-canopy-muted text-start">
                            {t(`catalogue:howPlans.example.${fact}Label`)}
                        </RNText>
                        <RNText className="text-sm font-bold text-content-on-canopy text-start">
                            {t(`catalogue:howPlans.example.${fact}Value`)}
                        </RNText>
                    </View>
                ))}
            </View>
        </View>
    );
}

/** "Questions people ask" — one card, a question to a row, one open at a time. */
function Faq() {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(FAQ_KEYS[0]);

    return (
        <View
            testID="how-plans-faq"
            className="overflow-hidden rounded-3xl border border-stroke-subtle bg-surface-raised"
        >
            {FAQ_KEYS.map((key, index) => {
                const isOpen = open === key;
                const headerId = `how-plans-faq-${key}-header`;
                const panelId = `how-plans-faq-${key}-panel`;
                return (
                    <View
                        key={key}
                        className={cx(
                            'flex-col',
                            index === 0 ? '' : 'border-t border-stroke-subtle',
                        )}
                    >
                        <Pressable
                            testID={`how-plans-faq-${key}`}
                            nativeID={headerId}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t(`catalogue:howPlans.faq.${key}.q`)}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            accessibilityState={{ expanded: isOpen }}
                            onPress={() => {
                                setOpen(isOpen ? null : key);
                            }}
                            className="min-h-[60px] flex-row items-center justify-between gap-3 px-[22px] hover:bg-surface-base"
                        >
                            <RNText className="flex-1 text-base font-bold text-content-primary text-start">
                                {t(`catalogue:howPlans.faq.${key}.q`)}
                            </RNText>
                            <Icon
                                name={isOpen ? 'chevronUp' : 'chevronDown'}
                                size="md"
                                className="text-content-secondary"
                            />
                        </Pressable>
                        <Collapse
                            testID={`how-plans-faq-${key}-panel`}
                            nativeID={panelId}
                            role="region"
                            aria-labelledby={headerId}
                            open={isOpen}
                        >
                            <RNText className="px-[22px] pb-[18px] text-base font-medium leading-relaxed text-content-secondary text-start">
                                {t(`catalogue:howPlans.faq.${key}.a`)}
                            </RNText>
                        </Collapse>
                    </View>
                );
            })}
        </View>
    );
}

/** The board's primary button: label, then an arrow in a soft circle. */
function ArrowButton({
    testID,
    label,
    onPress,
    tone = 'brand',
}: {
    readonly testID: string;
    readonly label: string;
    readonly onPress: () => void;
    readonly tone?: 'brand' | 'onCanopy';
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            onPress={onPress}
            className={cx(
                'h-[54px] flex-row items-center justify-between gap-3 rounded-2xl px-5',
                tone === 'brand'
                    ? 'bg-surface-brand hover:bg-surface-canopy'
                    : 'bg-surface-brand-subtle hover:bg-surface-raised',
            )}
        >
            <RNText
                className={cx(
                    'text-base font-bold',
                    tone === 'brand' ? 'text-content-on-brand' : 'text-content-on-brand-subtle',
                )}
            >
                {label}
            </RNText>
            <View
                className={cx(
                    'h-8 w-8 items-center justify-center rounded-full',
                    tone === 'brand' ? 'bg-content-on-brand/20' : 'bg-content-on-brand-subtle/10',
                )}
            >
                <Icon
                    name="chevronForward"
                    size="sm"
                    className={
                        tone === 'brand' ? 'text-content-on-brand' : 'text-content-on-brand-subtle'
                    }
                />
            </View>
        </Pressable>
    );
}

const CUTOFF_ICONS = { lock: 'lock', order: 'shoppingBasket', delivered: 'check' } as const;
const STATE_DOTS: Readonly<Record<string, string>> = {
    active: 'bg-success-on-subtle',
    paused: 'bg-warning-on-subtle',
    completed: 'bg-info-on-subtle',
    cancelled: 'bg-content-disabled',
};

export function HowPlansWorkScreen() {
    const { t } = useTranslation();
    const navigateUp = useNavigateUp();

    const plans = usePlansQuery({});
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

    // Both the back pill and "Choose a plan" lead to the listing this page is read from — so back to
    // it, kitchen chip and compare tray intact, when it is the page underneath (browse-05).
    const choosePlan = () => {
        navigateUp('/plans');
    };

    // An in-page jump only exists where there is a document to scroll; on native the calculator
    // is simply the next thing down, and a button that did nothing would be worse than none.
    const scrollToCalculator =
        Platform.OS === 'web'
            ? () => {
                  if (typeof document === 'undefined') return;
                  // `nativeID` is written out as the element's `id` by React Native Web. The shell's
                  // scroll port is what moves, and `scrollIntoView` scrolls whichever ancestor does.
                  document
                      .getElementById(CALCULATOR_ID)
                      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
              }
            : undefined;

    return (
        <View testID="how-plans-screen" className="flex-col pb-10">
            <View className="items-start pt-1">
                <BackPill
                    testID="how-plans-breadcrumbs"
                    label={t('catalogue:howPlans.breadcrumbPlans')}
                    onPress={choosePlan}
                />
            </View>

            <View
                testID="how-plans-hero"
                className="mt-[18px] flex-col gap-8 lg:flex-row lg:items-center"
            >
                <View className="min-w-0 flex-1 flex-col">
                    <RNText className="text-xs font-bold uppercase tracking-wider text-content-on-brand-subtle text-start">
                        {t('catalogue:howPlans.eyebrow')}
                    </RNText>
                    <RNText
                        testID="how-plans-title"
                        accessibilityRole="header"
                        aria-level={1}
                        className="mt-2.5 font-display text-4xl font-bold tracking-display text-content-primary text-start lg:text-5xl lg:leading-[52px]"
                    >
                        {t('catalogue:howPlans.title')}
                    </RNText>
                    <RNText className="mt-3.5 max-w-[560px] text-lg font-medium leading-relaxed text-content-secondary text-start">
                        {t('catalogue:howPlans.lede')}
                    </RNText>
                    <View className="mt-[22px] flex-row flex-wrap gap-2.5">
                        <ArrowButton
                            testID="how-plans-choose"
                            label={t('catalogue:howPlans.choosePlan')}
                            onPress={choosePlan}
                        />
                        {scrollToCalculator === undefined ? null : (
                            <Pressable
                                testID="how-plans-try-calculator"
                                role="button"
                                accessibilityRole="button"
                                onPress={scrollToCalculator}
                                className="h-[54px] justify-center rounded-2xl border border-stroke bg-surface-raised px-4 hover:bg-surface-brand-subtle"
                            >
                                <RNText className="text-sm font-semibold text-content-primary">
                                    {t('catalogue:howPlans.tryCalculator')}
                                </RNText>
                            </Pressable>
                        )}
                    </View>
                </View>
                <BalanceExample />
            </View>

            <View className="mt-10">
                <SectionTitle
                    testID="how-plans-rules-header"
                    title={t('catalogue:howPlans.rulesTitle')}
                />
                <View testID="how-plans-rules" className="flex-row flex-wrap gap-3.5">
                    {RULE_KEYS.map((key, index) => (
                        <View
                            key={key}
                            testID={`how-plans-rule-${key}`}
                            className="min-w-[260px] flex-1 basis-[300px] rounded-3xl border border-stroke-subtle bg-surface-raised p-5 transition duration-normal ease-standard hover:-translate-y-1 hover:shadow-elevation-3"
                        >
                            <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-surface-brand-subtle">
                                <RNText className="font-display text-base font-bold tabular-nums text-content-on-brand-subtle">
                                    {String(index + 1)}
                                </RNText>
                            </View>
                            <RNText
                                accessibilityRole="header"
                                aria-level={3}
                                className="mb-1.5 mt-3.5 font-display text-lg font-bold text-content-primary text-start"
                            >
                                {t(`catalogue:howPlans.rules.${key}.title`)}
                            </RNText>
                            <RNText className="text-sm font-medium leading-normal text-content-secondary text-start">
                                {t(`catalogue:howPlans.rules.${key}.body`)}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>

            <View className="mt-10" nativeID={CALCULATOR_ID}>
                <SectionTitle
                    testID="how-plans-calculator-title"
                    title={t('catalogue:howPlans.calculator.title')}
                />
                <View
                    testID="how-plans-calculator"
                    className="rounded-3xl border border-stroke-subtle bg-surface-raised p-6"
                >
                    <QueryStates
                        skeleton="plans"
                        query={plans}
                        isEmpty={(plans.data?.items.length ?? 0) === 0}
                        emptyTitle={t('catalogue:howPlans.calculator.empty')}
                        skeletonCount={1}
                        testID="how-plans-calculator-plans"
                    >
                        <PlanBalanceCalculator
                            plans={plans.data?.items ?? []}
                            kitchenNameById={kitchenNameById}
                        />
                    </QueryStates>
                </View>
            </View>

            <View className="mt-10">
                <SectionTitle
                    testID="how-plans-cutoff-title"
                    title={t('catalogue:howPlans.cutoff.eyebrow')}
                />
                <View className="flex-col gap-3.5 lg:flex-row">
                    <View
                        testID="how-plans-cutoff"
                        className="rounded-3xl border border-stroke-subtle bg-surface-raised p-[22px] lg:flex-[1.2]"
                    >
                        {CUTOFF_STEPS.map((step, index) => {
                            const last = index === CUTOFF_STEPS.length - 1;
                            return (
                                <View
                                    key={step}
                                    testID={`how-plans-cutoff-${step}`}
                                    className="flex-row gap-3.5"
                                >
                                    <View aria-hidden className="w-10 flex-col items-center">
                                        <View className="h-10 w-10 items-center justify-center rounded-full bg-surface-brand-subtle">
                                            <Icon
                                                name={CUTOFF_ICONS[step]}
                                                size="sm"
                                                className="text-content-on-brand-subtle"
                                            />
                                        </View>
                                        {last ? null : (
                                            <View className="min-h-[20px] w-0.5 flex-1 bg-stroke" />
                                        )}
                                    </View>
                                    <View
                                        className={cx(
                                            'min-w-0 flex-1 flex-col',
                                            last ? '' : 'pb-5',
                                        )}
                                    >
                                        <RNText className="text-xs font-bold uppercase tracking-wide text-content-on-brand-subtle text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.time`)}
                                        </RNText>
                                        <RNText className="mt-0.5 text-base font-bold text-content-primary text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.title`)}
                                        </RNText>
                                        <RNText className="mt-1 text-sm font-medium leading-normal text-content-secondary text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.body`)}
                                        </RNText>
                                    </View>
                                </View>
                            );
                        })}
                    </View>

                    <View
                        testID="how-plans-states"
                        className="flex-col gap-2.5 rounded-3xl border border-stroke-subtle bg-surface-raised p-[22px] lg:flex-1"
                    >
                        <RNText className="mb-1 text-sm font-bold uppercase tracking-wider text-content-secondary text-start">
                            {t('catalogue:howPlans.states.eyebrow')}
                        </RNText>
                        {STATES.map((state) => (
                            <View
                                key={state.key}
                                testID={`how-plans-state-${state.key}`}
                                className="flex-row gap-3 rounded-2xl bg-surface-base px-3.5 py-3"
                            >
                                <View
                                    aria-hidden
                                    className={cx(
                                        'mt-1 h-3 w-3 rounded-full',
                                        STATE_DOTS[state.key],
                                    )}
                                />
                                <View className="min-w-0 flex-1">
                                    <RNText className="text-base font-bold text-content-primary text-start">
                                        {t(`catalogue:howPlans.states.${state.key}.name`)}
                                    </RNText>
                                    <RNText className="mt-0.5 text-sm font-medium text-content-secondary text-start">
                                        {t(`catalogue:howPlans.states.${state.key}.body`)}
                                    </RNText>
                                    <RNText className="mt-1 text-xs font-semibold text-content-on-brand-subtle text-start">
                                        {t(`catalogue:howPlans.states.${state.key}.next`)}
                                    </RNText>
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
            </View>

            <View className="mt-10">
                <SectionTitle
                    testID="how-plans-faq-header"
                    title={t('catalogue:howPlans.faqTitle')}
                />
                <Faq />
            </View>

            <View
                testID="how-plans-cta"
                className="relative mt-10 flex-col gap-5 overflow-hidden rounded-[28px] bg-surface-canopy px-9 py-[34px] md:flex-row md:items-center md:justify-between"
            >
                <View
                    aria-hidden
                    pointerEvents="none"
                    className="absolute -end-20 -top-40 h-[420px] w-[420px] rounded-full bg-stage-green opacity-15"
                />
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="font-display text-3xl font-bold tracking-display text-content-on-canopy text-start"
                >
                    {t('catalogue:howPlans.closingTitle')}
                </RNText>
                <ArrowButton
                    testID="how-plans-cta-choose"
                    tone="onCanopy"
                    label={t('catalogue:howPlans.choosePlan')}
                    onPress={choosePlan}
                />
            </View>
        </View>
    );
}
