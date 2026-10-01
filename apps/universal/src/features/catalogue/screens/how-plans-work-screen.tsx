import { Breadcrumbs, Button, Collapse, Icon, cx } from '@healthy360/design-system';
import { gradients } from '@healthy360/design-tokens';
import { useFormatter } from '@healthy360/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, StyleSheet, View } from 'react-native';

import { usePlansQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { Eyebrow } from '../../../ui/eyebrow.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PlanBalanceCalculator } from '../plan-balance-calculator.tsx';
import { PlanPanel, StatePill } from '../plan-controls.tsx';
import type { StatePillTone } from '../plan-controls.tsx';

/**
 * `/plans/how-it-works` — HealthZone's `howplans` screen, element for element: the breadcrumb, the
 * title beside the canopy example panel, the six rules, the balance calculator, the cut-off
 * timeline beside the plan states, the questions people ask, and the closing brand band.
 *
 * ## Every rule is the platform's, checked against it
 *
 * The design's model — "a plan is a balance of delivery days, not a calendar" — is the approved S1
 * semantics (`docs/s1-subscription-semantics-proposal.md`, D-077), and the backend implements it:
 * `subscriptions.balance_days_total` / `balance_days_consumed`, a captured per-day price, a credit
 * memo for the unused days on cancellation. The copy keeps the design's sentences and follows the
 * implementation where the drawing says more than it does:
 *
 * - **Balances are 7, 14, 28 or 84 days**, the closed duration vocabulary, not 10/20/30.
 * - **The cut-off is the plan's, not a constant.** `change_cutoff_hours` defaults to 24 and a
 *   kitchen may set another, so the rules say "24 hours before, unless the plan sets its own".
 * - **A day is used when the order is created**, at the cut-off, not on delivery
 *   (`GenerationService`); a kitchen-cancelled order gives the day back.
 * - **Skips and pauses are the plan's to allow** (`skip_allowed`, `pause_allowed`), and a skip is
 *   one delivery, not a week.
 * - **A cancellation credits, it does not refund.** The unused days are recorded as a credit for
 *   the kitchen to settle by hand until payments exist (§3).
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

/** The example balance drawn in the hero: a 14-day run, six of them delivered. */
const EXAMPLE_DAYS = 14;
const EXAMPLE_DELIVERED = 6;
const EXAMPLE_COLUMNS = 7;

/** The calculator's anchor, for the hero's "Try the balance calculator" on the web. */
const CALCULATOR_ID = 'plans-balance-calculator';

const RULE_KEYS = ['days', 'skip', 'cutoff', 'price', 'allergies', 'cancel'] as const;
const CUTOFF_STEPS = ['lock', 'order', 'delivered'] as const;
const STATES: readonly { readonly key: string; readonly tone: StatePillTone }[] = [
    { key: 'active', tone: 'success' },
    { key: 'paused', tone: 'warning' },
    { key: 'completed', tone: 'info' },
    { key: 'cancelled', tone: 'danger' },
];
const FAQ_KEYS = ['soldOut', 'chooseMeals', 'expire', 'address', 'priceRise'] as const;

function SectionHeader({
    title,
    meta,
    testID,
    className,
}: {
    readonly title: string;
    readonly meta?: string | undefined;
    readonly testID: string;
    readonly className?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx(
                'flex-row flex-wrap items-baseline justify-between gap-2 border-b border-stroke pb-3',
                className,
            )}
        >
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="font-display text-2xl font-bold tracking-display text-content-primary text-start"
            >
                {title}
            </RNText>
            {meta === undefined ? null : <Eyebrow>{meta}</Eyebrow>}
        </View>
    );
}

/** The canopy illustration beside the title: a balance as cells, some used, the rest still yours. */
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
            className="min-w-[280px] flex-1 basis-[440px] overflow-hidden rounded-xl"
        >
            <LinearGradient
                colors={gradients.canopy.colours}
                locations={gradients.canopy.locations}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
            />
            <View className="flex-1 flex-col gap-3 px-8 py-8">
                <Eyebrow tone="canopy">
                    {t('catalogue:howPlans.example.eyebrow', {
                        days: formatter.formatNumber(EXAMPLE_DAYS),
                    })}
                </Eyebrow>
                <RNText
                    testID="how-plans-example-left"
                    className="font-display text-5xl font-bold leading-none tracking-display text-content-on-canopy text-start"
                >
                    {t('catalogue:howPlans.example.left', { count: remaining })}
                </RNText>
                <RNText className="text-sm text-content-on-canopy-muted text-start">
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
                    className="mt-1.5 flex-col gap-2"
                >
                    {rows.map((row) => (
                        <View key={row[0]} className="flex-row gap-2">
                            {row.map((cell) => (
                                <View
                                    key={cell}
                                    className={cx(
                                        'aspect-square min-w-0 flex-1 rounded',
                                        cell < EXAMPLE_DELIVERED
                                            ? 'bg-surface-brand'
                                            : 'border-2 border-content-on-canopy-muted',
                                    )}
                                />
                            ))}
                        </View>
                    ))}
                </View>
                <View className="flex-row flex-wrap gap-4">
                    <View className="flex-row items-center gap-2">
                        <View aria-hidden className="h-3 w-3 rounded-sm bg-surface-brand" />
                        <Eyebrow tone="canopy">{t('catalogue:howPlans.example.delivered')}</Eyebrow>
                    </View>
                    <View className="flex-row items-center gap-2">
                        <View
                            aria-hidden
                            className="h-3 w-3 rounded-sm border-2 border-content-on-canopy-muted"
                        />
                        <Eyebrow tone="canopy">
                            {t('catalogue:howPlans.example.stillYours')}
                        </Eyebrow>
                    </View>
                </View>
                <View className="mt-auto flex-row gap-4 border-t border-surface-canopy-deep pt-4">
                    {(['price', 'skips'] as const).map((fact) => (
                        <View key={fact} className="min-w-0 flex-1 flex-col gap-1">
                            <Eyebrow tone="canopy">
                                {t(`catalogue:howPlans.example.${fact}Label`)}
                            </Eyebrow>
                            <RNText className="font-display text-lg font-bold text-content-on-canopy text-start">
                                {t(`catalogue:howPlans.example.${fact}Value`)}
                            </RNText>
                        </View>
                    ))}
                </View>
            </View>
        </View>
    );
}

/**
 * The design's question list: open rows divided by hairlines, the question at body-large weight and
 * a plus that turns into a minus. `Accordion` draws a boxed list with chevrons, which is a different
 * component on the page; the behaviour — one open at a time, `aria-expanded`, the answer as a
 * labelled region — is the same.
 */
function Faq() {
    const { t } = useTranslation();
    const [open, setOpen] = useState<string | null>(FAQ_KEYS[0]);

    return (
        <View testID="how-plans-faq" className="mt-1.5 flex-col">
            {FAQ_KEYS.map((key) => {
                const isOpen = open === key;
                const headerId = `how-plans-faq-${key}-header`;
                const panelId = `how-plans-faq-${key}-panel`;
                return (
                    <View key={key} className="flex-col border-b border-stroke">
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
                            className="min-h-touch flex-row items-center justify-between gap-4 py-4"
                        >
                            <RNText className="flex-1 text-base font-semibold text-content-primary text-start">
                                {t(`catalogue:howPlans.faq.${key}.q`)}
                            </RNText>
                            <Icon
                                name={isOpen ? 'minus' : 'plus'}
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
                            <RNText className="max-w-[720px] pb-4 text-base leading-relaxed text-content-secondary text-start">
                                {t(`catalogue:howPlans.faq.${key}.a`)}
                            </RNText>
                        </Collapse>
                    </View>
                );
            })}
        </View>
    );
}

export function HowPlansWorkScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const plans = usePlansQuery({});
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

    const choosePlan = () => {
        router.push('/plans');
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
        <View testID="how-plans-screen" className="flex-col">
            <Breadcrumbs
                testID="how-plans-breadcrumbs"
                items={[
                    {
                        key: 'plans',
                        label: t('catalogue:howPlans.breadcrumbPlans'),
                        onPress: choosePlan,
                    },
                    { key: 'how', label: t('catalogue:howPlans.breadcrumbCurrent') },
                ]}
            />

            <View testID="how-plans-hero" className="mt-3 flex-row flex-wrap items-stretch gap-8">
                <View className="min-w-[280px] flex-1 basis-[440px] flex-col justify-center gap-4 py-2.5">
                    <Eyebrow>{t('catalogue:howPlans.eyebrow')}</Eyebrow>
                    <RNText
                        testID="how-plans-title"
                        accessibilityRole="header"
                        aria-level={1}
                        className="font-display text-4xl font-bold leading-none tracking-display text-content-primary text-start lg:text-5xl lg:leading-none"
                    >
                        {t('catalogue:howPlans.title')}
                    </RNText>
                    <RNText className="max-w-[520px] text-base leading-relaxed text-content-secondary text-start">
                        {t('catalogue:howPlans.lede')}
                    </RNText>
                    <View className="mt-1.5 flex-row flex-wrap gap-2.5">
                        <Button
                            testID="how-plans-choose"
                            variant="primary"
                            size="lg"
                            label={t('catalogue:howPlans.choosePlan')}
                            onPress={choosePlan}
                        />
                        {scrollToCalculator === undefined ? null : (
                            <Button
                                testID="how-plans-try-calculator"
                                variant="secondary"
                                size="lg"
                                label={t('catalogue:howPlans.tryCalculator')}
                                onPress={scrollToCalculator}
                            />
                        )}
                    </View>
                </View>
                <BalanceExample />
            </View>

            <SectionHeader
                testID="how-plans-rules-header"
                className="mt-12"
                title={t('catalogue:howPlans.rulesTitle')}
                meta={t('catalogue:howPlans.rulesMeta')}
            />
            <View testID="how-plans-rules" className="mt-4 flex-row flex-wrap gap-4">
                {RULE_KEYS.map((key, index) => (
                    <View
                        key={key}
                        testID={`how-plans-rule-${key}`}
                        className="min-w-[280px] flex-1 basis-[300px] flex-col gap-2.5 rounded-xl border border-stroke bg-surface-raised p-6"
                    >
                        <View className="h-[34px] w-[34px] items-center justify-center rounded-full bg-surface-brand-subtle">
                            <RNText className="text-xs font-semibold tabular-nums text-content-on-brand-subtle">
                                {formatNumberPadded(index + 1)}
                            </RNText>
                        </View>
                        <RNText
                            accessibilityRole="header"
                            aria-level={3}
                            className="font-display text-lg font-bold tracking-display text-content-primary text-start"
                        >
                            {t(`catalogue:howPlans.rules.${key}.title`)}
                        </RNText>
                        <RNText className="text-sm leading-relaxed text-content-secondary text-start">
                            {t(`catalogue:howPlans.rules.${key}.body`)}
                        </RNText>
                    </View>
                ))}
            </View>

            <PlanPanel
                testID="how-plans-calculator"
                nativeID={CALCULATOR_ID}
                className="mt-10 px-6 py-6 md:px-8"
            >
                <Eyebrow>{t('catalogue:howPlans.calculator.eyebrow')}</Eyebrow>
                <RNText
                    accessibilityRole="header"
                    aria-level={2}
                    className="mb-1 mt-2 font-display text-2xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('catalogue:howPlans.calculator.title')}
                </RNText>
                <RNText className="text-sm text-content-secondary text-start">
                    {t('catalogue:howPlans.calculator.body')}
                </RNText>
                <View className="mt-6">
                    <QueryStates
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
            </PlanPanel>

            <View className="mt-4 flex-row flex-wrap gap-4">
                <PlanPanel
                    testID="how-plans-cutoff"
                    className="min-w-[280px] flex-1 basis-[320px] p-6"
                >
                    <Eyebrow>{t('catalogue:howPlans.cutoff.eyebrow')}</Eyebrow>
                    <View className="mt-4 flex-col">
                        {CUTOFF_STEPS.map((step, index) => {
                            const last = index === CUTOFF_STEPS.length - 1;
                            return (
                                <View
                                    key={step}
                                    testID={`how-plans-cutoff-${step}`}
                                    className="flex-row gap-3"
                                >
                                    <View aria-hidden className="w-[22px] flex-col items-center">
                                        <View
                                            className={cx(
                                                'mt-0.5 h-[13px] w-[13px] rounded-full border-2 border-surface-brand',
                                                last ? 'bg-surface-brand' : 'bg-surface-raised',
                                            )}
                                        />
                                        {last ? null : (
                                            <View className="min-h-[20px] w-0.5 flex-1 bg-stroke-strong" />
                                        )}
                                    </View>
                                    <View className="min-w-0 flex-1 flex-col pb-4">
                                        <RNText className="text-xs font-semibold uppercase tabular-nums text-content-secondary text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.time`)}
                                        </RNText>
                                        <RNText className="mt-0.5 font-display text-base font-bold tracking-display text-content-primary text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.title`)}
                                        </RNText>
                                        <RNText className="mt-0.5 text-sm leading-normal text-content-secondary text-start">
                                            {t(`catalogue:howPlans.cutoff.${step}.body`)}
                                        </RNText>
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                </PlanPanel>

                <PlanPanel
                    testID="how-plans-states"
                    className="min-w-[280px] flex-1 basis-[320px] p-6"
                >
                    <Eyebrow>{t('catalogue:howPlans.states.eyebrow')}</Eyebrow>
                    <View className="mt-4 flex-col gap-3">
                        {STATES.map((state) => (
                            <View
                                key={state.key}
                                testID={`how-plans-state-${state.key}`}
                                className="flex-row items-start gap-3 border-b border-stroke-subtle pb-3"
                            >
                                <View className="w-[112px]">
                                    <StatePill
                                        tone={state.tone}
                                        label={t(`catalogue:howPlans.states.${state.key}.name`)}
                                    />
                                </View>
                                <View className="min-w-0 flex-1 flex-col gap-1">
                                    <RNText className="text-sm leading-normal text-content-primary text-start">
                                        {t(`catalogue:howPlans.states.${state.key}.body`)}
                                    </RNText>
                                    <Eyebrow>
                                        {t(`catalogue:howPlans.states.${state.key}.next`)}
                                    </Eyebrow>
                                </View>
                            </View>
                        ))}
                    </View>
                </PlanPanel>
            </View>

            <SectionHeader
                testID="how-plans-faq-header"
                className="mt-12"
                title={t('catalogue:howPlans.faqTitle')}
            />
            <Faq />

            <View
                testID="how-plans-cta"
                className="mt-10 flex-row flex-wrap items-center justify-between gap-5 rounded-xl bg-surface-brand-subtle px-8 py-8"
            >
                <View className="min-w-[240px] flex-1 flex-col gap-1.5">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="font-display text-3xl font-bold leading-tight tracking-display text-content-on-brand-subtle text-start"
                    >
                        {t('catalogue:howPlans.ctaTitle')}
                    </RNText>
                    <RNText className="text-base text-content-on-brand-subtle text-start">
                        {t('catalogue:howPlans.ctaBody')}
                    </RNText>
                </View>
                <Button
                    testID="how-plans-cta-choose"
                    variant="primary"
                    size="lg"
                    label={t('catalogue:howPlans.choosePlan')}
                    onPress={choosePlan}
                />
            </View>
        </View>
    );
}

/** "01" … "06": the rule's ordinal as the design sets it, two digits. */
function formatNumberPadded(value: number): string {
    return String(value).padStart(2, '0');
}
