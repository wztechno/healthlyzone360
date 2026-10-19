import {
    Button,
    Callout,
    Card,
    EmptyState,
    Icon,
    Inline,
    Stack,
    StepProgress,
    Text,
    useBreakpoint,
} from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    Subscription,
    SubscriptionRefusal,
} from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import type { AllergenCode, PlanVariantId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import {
    toFailure,
    useAllowedDeliveryWeekdaysQuery,
    useCreateSubscriptionMutation,
    useSubscriptionPreviewQuery,
} from '../../../data/commerce-hooks.ts';
import { useAddressesQuery } from '../../../data/account-hooks.ts';
import { useCurrentTargetsQuery, useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { AccountSetupSteps, stepForRequirement } from '../../account/account-setup-steps.tsx';
import type { AccountSetupStep } from '../../account/account-setup-steps.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { EMPTY_ADDRESS, toDeliveryAddress, validateAddress } from '../address.ts';
import type { AddressField } from '../address.ts';
import {
    DeliveryStep,
    PlanStep,
    ReviewStep,
    TermsAcknowledgement,
} from '../configurator-steps.tsx';
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    initialConfiguratorState,
    isStepReachable,
    mealCombinations,
    nextConfiguratorStep,
    previousConfiguratorStep,
    stepPosition,
    storedAllergenCodes,
    storedDietClassifications,
    toConfiguration,
    validateConfiguratorStep,
    variantById,
    variantForCombination,
} from '../configurator.ts';
import type { ConfiguratorState, ConfiguratorStep, StepContext } from '../configurator.ts';
import { earliestStartDate } from '../dates.ts';
import { deliveryAreaStatus, servedAreas } from '../delivery.ts';
import { PlanSetupSummary } from '../plan-setup-summary.tsx';
import { SubscriptionStateBadge } from '../state-badge.tsx';

/**
 * `/customer/subscriptions/new?plan={id}` — setting up a subscription, in three steps.
 *
 * ① **Plan** — calorie band, meals a day, length. ② **Delivery** — days, start, window, address,
 * diet and allergies. ③ **Review** — the choices with an Edit back to each, the server's price, the
 * first week's meals (optional, folded away) and the terms. `configurator.ts` holds the rules.
 *
 * Beside the step, from `lg`, a summary card states what has been chosen and the price, and carries
 * the action that moves the flow on; below `lg` it is a bar pinned to the foot of the page. The
 * price is there from the first step — an estimate until the review step has the server's preview.
 *
 * ## The confirm step is real
 *
 * `createSubscription` exists, the prototype world stores the result, and the subscription that
 * appears on `/customer/subscriptions` afterwards is the one this screen made. No payment is taken,
 * because the contract has no method that could take one.
 *
 * ## What the configurator has to discover rather than read
 *
 * A plan's delivery weekdays are not on `SubscriptionPlan`, so they are probed through the preview
 * (`data/commerce-hooks.ts`). The allergen vocabulary is not published either, so the choices are
 * the union of what this kitchen declares on its own menu and what the person's profile already
 * excludes. Both are recorded as contract gaps rather than hard-coded lists.
 */

export interface SubscriptionConfiguratorScreenProps {
    readonly planId: string | undefined;
    readonly variantId?: string | undefined;
}

export function SubscriptionConfiguratorScreen({
    planId,
    variantId,
}: SubscriptionConfiguratorScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const validationTranslate = useValidationTranslate();

    const parsedPlanId = planId === undefined ? null : SubscriptionPlanId.safeParse(planId);
    const plan = usePlanQuery(parsedPlanId);
    const item = plan.data;

    const kitchen = useKitchenQuery(item?.kitchenId ?? null);
    const targets = useCurrentTargetsQuery(true);
    const menuQuery = useMealsQuery(
        item === undefined ? undefined : { kitchenIds: [item.kitchenId], limit: 50 },
        item !== undefined,
    );
    const menu: readonly MarketplaceMeal[] = mealsFromPages(menuQuery.data?.pages);

    const [step, setStep] = useState<ConfiguratorStep>('plan');
    const [showIssues, setShowIssues] = useState(false);
    const [created, setCreated] = useState<Subscription | null>(null);
    const [addressId, setAddressId] = useState<string | null>(null);

    const addresses = useAddressesQuery();
    // Memoised rather than `?? []` inline: the fallback allocates a fresh array on every render,
    // which would change the identity of every `useMemo` below that depends on this list.
    const addressList = useMemo<readonly CustomerAddress[]>(
        () => addresses.data ?? [],
        [addresses.data],
    );

    /**
     * ## Defaults are derived, edits are held
     *
     * Three things the configurator starts from arrive asynchronously: the plan, the weekdays it
     * delivers on, and the allergies already on the person's profile. The obvious shape — one piece
     * of state, seeded by an effect as each answer lands — is exactly the shape React now warns
     * about, and for a good reason: it renders once with the wrong defaults and then again with the
     * right ones.
     *
     * So the state is a **derivation**. `defaults` recomputes as the data arrives; `edits` holds
     * only what the person has actually changed, and wins. A weekday nobody has touched updates the
     * moment the probe answers; one they deselected stays deselected, because it is in `edits`.
     */
    const [edits, setEdits] = useState<Partial<ConfiguratorState>>({});

    const patch = useCallback((next: Partial<ConfiguratorState>) => {
        setEdits((current) => ({ ...current, ...next }));
    }, []);

    /**
     * One address field at a time, against the latest edits rather than the rendered snapshot.
     *
     * Typing into two fields inside a single React batch — which is exactly what a form fill does —
     * would otherwise compose two new addresses from the same starting value and keep only the
     * second. The base is `EMPTY_ADDRESS` because the configurator always starts from a blank one.
     */
    const patchAddressField = useCallback((field: AddressField, value: string) => {
        setEdits((current) => ({
            ...current,
            address: { ...(current.address ?? EMPTY_ADDRESS), [field]: value },
        }));
    }, []);

    const storedAllergens = useMemo(
        () => storedAllergenCodes(targets.data?.result.request.constraints),
        [targets.data],
    );

    const storedDiets = useMemo(
        () =>
            item === undefined
                ? []
                : storedDietClassifications(
                      targets.data?.result.request.constraints,
                      item.dietClassifications,
                  ),
        [item, targets.data],
    );

    /* ── the weekday probe, and the defaults it feeds ───────────────────────────────────────── */

    // A probe configuration exists as soon as the plan does. Its delivery weekdays are irrelevant —
    // the hook replaces them, one weekday at a time — and its query key is the plan and the variant,
    // so typing an address does not re-run seven requests.
    const probe = useMemo(() => {
        if (item === undefined) return null;
        const seed = initialConfiguratorState({
            plan: item,
            variantId: variantId === undefined ? null : (variantId as PlanVariantId),
            startDate: earliestStartDate(),
        });
        return toConfiguration({ ...seed, ...edits, deliveryWeekdays: [1] }, item, (values) =>
            toDeliveryAddress(values),
        );
    }, [edits, item, variantId]);

    const weekdays = useAllowedDeliveryWeekdaysQuery(probe);
    const allowedWeekdays: readonly number[] | null = weekdays.data ?? null;

    const defaults = useMemo<ConfiguratorState | null>(() => {
        if (item === undefined) return null;
        return initialConfiguratorState({
            plan: item,
            variantId: variantId === undefined ? null : (variantId as PlanVariantId),
            startDate: earliestStartDate(),
            // Every day the plan can deliver on, pre-selected: the common case is "all of them", and
            // removing a few is a smaller job than choosing from nothing.
            ...(weekdays.data === undefined ? {} : { allowedWeekdays: weekdays.data }),
            storedAllergens,
            storedDiets,
        });
    }, [item, storedAllergens, storedDiets, variantId, weekdays.data]);

    const state = useMemo<ConfiguratorState | null>(
        () => (defaults === null ? null : { ...defaults, ...edits }),
        [defaults, edits],
    );

    /* ── derived ─────────────────────────────────────────────────────────────────────────────── */

    const variant =
        item === undefined || state === null ? null : variantById(item, state.variantId);

    const addressErrors = useMemo(
        () => (state === null ? {} : validateAddress(state.address, validationTranslate)),
        [state, validationTranslate],
    );

    const savedAddress = addressList.find((entry) => entry.id === addressId);
    const areaStatus = useMemo(() => {
        // A saved address carries the server's own answer, computed against the published zone
        // coverage — authoritative over any client-side comparison of area strings, whose
        // granularities (gazetteer rows vs a zone's display label) need not match textually.
        if (savedAddress !== undefined) return savedAddress.isDeliverable ? 'served' : 'unserved';
        return deliveryAreaStatus(kitchen.data, state?.address.area ?? '');
    }, [savedAddress, kitchen.data, state?.address.area]);

    const areas = useMemo(() => servedAreas(kitchen.data), [kitchen.data]);

    const allergenOptions = useMemo<readonly AllergenCode[]>(() => {
        const codes = new Set<AllergenCode>(storedAllergens);
        for (const meal of menu) for (const code of meal.allergens) codes.add(code);
        return [...codes].sort((left, right) => String(left).localeCompare(String(right)));
    }, [menu, storedAllergens]);

    const context = useMemo<StepContext | null>(() => {
        if (item === undefined) return null;
        return {
            plan: item,
            allowedWeekdays,
            areaStatus,
            hasSavedAddress: addressId !== null,
            earliestStartDate: earliestStartDate(),
            storedAllergens,
            translate: (key: string) => validationTranslate(key),
        };
    }, [addressId, allowedWeekdays, areaStatus, item, storedAllergens, validationTranslate]);

    const issues =
        state === null || context === null ? [] : validateConfiguratorStep(step, state, context);

    // The server prices the configuration on the review step; until then the summary estimates.
    const configuration = useMemo(() => {
        if (item === undefined || state === null || step !== 'review') return null;
        return toConfiguration(state, item, (values) => toDeliveryAddress(values));
    }, [item, state, step]);

    const preview = useSubscriptionPreviewQuery(configuration);
    const create = useCreateSubscriptionMutation();
    const createFailure = toFailure(create.error);

    /* ── navigation ──────────────────────────────────────────────────────────────────────────── */

    const goTo = useCallback((target: ConfiguratorStep) => {
        setShowIssues(false);
        setStep(target);
    }, []);

    const onBack = useCallback(() => {
        const target = previousConfiguratorStep(step);
        if (target !== null) goTo(target);
    }, [goTo, step]);

    const onNext = useCallback(() => {
        if (state === null || context === null) return;
        if (validateConfiguratorStep(step, state, context).length > 0) {
            setShowIssues(true);
            return;
        }
        const target = nextConfiguratorStep(step);
        if (target !== null) goTo(target);
    }, [context, goTo, state, step]);

    const onCreate = useCallback(() => {
        if (state === null || item === undefined || context === null) return;
        if (validateConfiguratorStep('review', state, context).length > 0) {
            setShowIssues(true);
            return;
        }
        const request = toConfiguration(state, item, (values) => toDeliveryAddress(values));
        if (request === null) {
            setShowIssues(true);
            return;
        }
        create.mutate(
            {
                configuration: request,
                acknowledgedTerms: state.termsAcknowledged,
                ...(addressId === null ? {} : { addressId }),
            },
            { onSuccess: setCreated },
        );
    }, [addressId, context, create, item, state]);

    /* ── render ──────────────────────────────────────────────────────────────────────────────── */

    const browseAction = (
        <Button
            testID="configurator-browse"
            label={t('commerce:configurator.browsePlans')}
            onPress={() => {
                router.push('/plans');
            }}
        />
    );

    if (created !== null) {
        return (
            <SubscriptionCreated
                subscription={created}
                onOpen={() => {
                    router.replace(`/customer/subscriptions/${String(created.id)}` as never);
                }}
                onList={() => {
                    router.replace('/customer/account?section=subscriptions' as never);
                }}
            />
        );
    }

    if (parsedPlanId === null) {
        return (
            <Stack space="lg" testID="configurator-screen">
                <EmptyState
                    testID="configurator-empty"
                    title={t('commerce:configurator.notFoundTitle')}
                    body={t('commerce:configurator.notFoundBody')}
                    actions={browseAction}
                />
            </Stack>
        );
    }

    const current = stepPosition(step) - 1;
    const wide = atLeast('lg');

    return (
        <View testID="configurator-screen" className="flex-col">
            <ListingHeader
                testID="configurator-header"
                breadcrumbs={[
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        onPress: () => {
                            router.push('/plans');
                        },
                    },
                    ...(item === undefined
                        ? []
                        : [
                              {
                                  key: 'plan',
                                  label: item.name,
                                  onPress: () => {
                                      router.push(`/plans/${String(item.id)}` as never);
                                  },
                              },
                          ]),
                ]}
                title={
                    item === undefined
                        ? t('commerce:configurator.title')
                        : t('commerce:configurator.titleFor', { plan: item.name })
                }
            />

            <QueryStates
                query={plan}
                isEmpty={item === undefined}
                emptyTitle={t('commerce:configurator.notFoundTitle')}
                emptyBody={t('commerce:configurator.notFoundBody')}
                emptyActions={browseAction}
                skeletonCount={2}
                testID="configurator"
            >
                {item === undefined || state === null ? null : (
                    <View className="mt-6 flex-col gap-8 lg:flex-row lg:items-start">
                        <View className="min-w-0 flex-col lg:flex-1">
                            <View className="mb-2">
                                <StepProgress
                                    testID="configurator-stepper"
                                    label={t('commerce:configurator.progressLabel')}
                                    steps={CONFIGURATOR_STEPS.map((key) => ({
                                        key,
                                        label: t(`commerce:configurator.steps.${key}`),
                                        disabled:
                                            state === null ||
                                            context === null ||
                                            !isStepReachable(key, state, context),
                                        testID: `configurator-progress-${key}`,
                                    }))}
                                    current={current}
                                    completed={
                                        new Set(
                                            CONFIGURATOR_STEPS.map((_, index) => index).filter(
                                                (i) => i < current,
                                            ),
                                        )
                                    }
                                    onSelect={(index) => {
                                        const target = CONFIGURATOR_STEPS[index];
                                        if (target !== undefined && target !== step) goTo(target);
                                    }}
                                />
                            </View>
                            {step === 'plan' ? (
                                <PlanStep
                                    plan={item}
                                    variant={variant}
                                    state={state}
                                    patch={patch}
                                    onCombination={(key) => {
                                        const combination = mealCombinations(item).find(
                                            (option) => combinationKey(option) === key,
                                        );
                                        if (combination === undefined) return;
                                        const next = variantForCombination(
                                            item,
                                            combination,
                                            variant,
                                        );
                                        if (next !== null) patch({ variantId: next.id });
                                    }}
                                />
                            ) : null}

                            {step === 'delivery' ? (
                                <DeliveryStep
                                    plan={item}
                                    state={state}
                                    patch={patch}
                                    onAddressField={patchAddressField}
                                    allowedWeekdays={allowedWeekdays}
                                    areaStatus={areaStatus}
                                    servedAreas={areas}
                                    addressErrors={addressErrors}
                                    allergenOptions={allergenOptions}
                                    storedAllergens={storedAllergens}
                                    showIssues={showIssues}
                                    savedAddresses={addressList}
                                    addressId={addressId}
                                    onAddressIdChange={setAddressId}
                                />
                            ) : null}

                            {step === 'review' ? (
                                <QueryStates
                                    query={preview}
                                    isEmpty={preview.data === undefined}
                                    emptyTitle={t('commerce:configurator.previewEmptyTitle')}
                                    emptyBody={t('commerce:configurator.previewEmptyBody')}
                                    skeletonCount={2}
                                    testID="configurator-preview"
                                >
                                    <ReviewStep
                                        plan={item}
                                        state={state}
                                        patch={patch}
                                        preview={preview.data}
                                        savedAddress={savedAddress}
                                        menu={menu}
                                        onEdit={goTo}
                                    />
                                </QueryStates>
                            ) : null}

                            {previousConfiguratorStep(step) === null ? null : (
                                <View className="mt-5 self-start">
                                    <Button
                                        testID="configurator-back"
                                        variant="quiet"
                                        label={t('commerce:configurator.back')}
                                        onPress={onBack}
                                    />
                                </View>
                            )}
                        </View>

                        {/*
                         * Sticky on the web against the shell's scroll port: beside the step from
                         * `lg`, pinned to the foot of the page below it. The wrapper sticks, not the
                         * card — a sticky box sticks within its parent.
                         */}
                        <View
                            className={
                                wide
                                    ? 'w-[320px] web:sticky web:top-6'
                                    : 'z-10 web:sticky web:bottom-4'
                            }
                        >
                            <PlanSetupSummary
                                plan={item}
                                variant={variant}
                                state={state}
                                showDelivery={step !== 'plan'}
                                preview={preview.data}
                                actionLabel={
                                    step === 'review'
                                        ? t('commerce:configurator.create')
                                        : t('commerce:configurator.next')
                                }
                                actionTestID={
                                    step === 'review' ? 'configurator-create' : 'configurator-next'
                                }
                                actionLoading={step === 'review' && create.isPending}
                                onAction={step === 'review' ? onCreate : onNext}
                                notice={
                                    <SetupNotice
                                        issues={showIssues ? issues : []}
                                        failure={createFailure?.message ?? null}
                                        reasons={
                                            createFailure?.code === 'subscription.refused'
                                                ? createFailure.reasons
                                                : []
                                        }
                                    />
                                }
                                {...(step === 'review'
                                    ? {
                                          confirm: (
                                              <TermsAcknowledgement state={state} patch={patch} />
                                          ),
                                      }
                                    : {})}
                            />
                        </View>
                    </View>
                )}
            </QueryStates>
        </View>
    );
}

/**
 * What still stands between the person and the action, drawn beside the action itself: each
 * unanswered question as one line, and a refusal from the server under its title. Nothing at all
 * when there is nothing to say.
 *
 * A refusal names **every** reason, and each is said: "cannot be started as it stands" alone sends
 * somebody back through three steps with nothing to change. Account setup the server is waiting on
 * becomes the checkout's rows — what is missing and a button to the screen that does it — and a
 * reason this build has no sentence for still appears, as the server's code.
 */
function SetupNotice({
    issues,
    failure,
    reasons,
}: {
    readonly issues: readonly string[];
    readonly failure: string | null;
    readonly reasons: readonly SubscriptionRefusal[];
}) {
    const { t } = useTranslation();
    if (issues.length === 0 && failure === null) return null;

    const setupSteps: AccountSetupStep[] = [];
    for (const entry of reasons) {
        if (entry.reason !== 'account_not_ready') continue;
        const step = stepForRequirement(entry.context['outstanding']);
        if (step === null || setupSteps.some((existing) => existing.step === step)) continue;
        setupSteps.push({ step, hasAddress: entry.context['has_address'] === true });
    }
    const otherReasons = reasons.filter(
        (entry) =>
            entry.reason !== 'account_not_ready' ||
            stepForRequirement(entry.context['outstanding']) === null,
    );

    return (
        <View testID="configurator-issues" role="alert" className="flex-col gap-1.5">
            {failure === null ? null : (
                <View testID="configurator-create-error" className="flex-col gap-1">
                    <RNText className="self-start text-sm font-semibold text-danger-on-subtle text-start">
                        {t('commerce:configurator.createFailedTitle')}
                    </RNText>
                    {reasons.length === 0 ? (
                        <RNText className="self-start text-sm text-danger-on-subtle text-start">
                            {failure}
                        </RNText>
                    ) : null}
                    {otherReasons.map((entry) => (
                        <View
                            key={entry.reason}
                            testID={`configurator-create-reason-${entry.reason}`}
                            className="flex-row items-start gap-2"
                        >
                            <Icon
                                name="warning"
                                size="sm"
                                className="mt-0.5 text-danger-on-subtle"
                            />
                            <RNText className="min-w-0 shrink self-start text-sm text-danger-on-subtle text-start">
                                {t(
                                    [
                                        `errors:subscriptionRefusal.${entry.reason}`,
                                        `errors:orderRefusal.${entry.reason}`,
                                    ],
                                    { defaultValue: entry.reason },
                                )}
                            </RNText>
                        </View>
                    ))}
                    {setupSteps.length === 0 ? null : (
                        <AccountSetupSteps steps={setupSteps} testID="configurator-setup-step" />
                    )}
                </View>
            )}
            {issues.map((key) => (
                <View
                    key={key}
                    testID={`configurator-issue-${key.split('.').pop() ?? key}`}
                    className="flex-row items-start gap-2"
                >
                    <Icon name="warning" size="sm" className="mt-0.5 text-danger-on-subtle" />
                    <RNText className="min-w-0 shrink self-start text-sm text-danger-on-subtle text-start">
                        {t(key)}
                    </RNText>
                </View>
            ))}
        </View>
    );
}

interface SubscriptionCreatedProps {
    readonly subscription: Subscription;
    readonly onOpen: () => void;
    readonly onList: () => void;
}

/**
 * The success state.
 *
 * It reports the subscription's **actual** state rather than the word "confirmed": the repository
 * decides what a new subscription starts as, and a screen that hard-codes "active" would be wrong
 * the day a draft state is introduced.
 */
function SubscriptionCreated({ subscription, onOpen, onList }: SubscriptionCreatedProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="lg" testID="configurator-success-screen">
            <Callout
                testID="configurator-success"
                role="status"
                tone="success"
                icon="success"
                title={t('commerce:configurator.successTitle')}
                body={t('commerce:configurator.successBody', { plan: subscription.planName })}
            />

            <Card testID="configurator-success-summary" padding="md" tone="sunken">
                <Stack space="sm">
                    <Inline space="sm" align="center" justify="between">
                        <Text variant="bodyStrong">{subscription.planName}</Text>
                        <SubscriptionStateBadge
                            state={subscription.state}
                            testID="configurator-success-state"
                        />
                    </Inline>
                    <Text testID="configurator-success-price">
                        {t('commerce:subscriptions.weeklyPrice', {
                            price: formatMoney(formatter, subscription.weeklyPrice),
                        })}
                    </Text>
                    <Text tone="secondary" testID="configurator-success-next">
                        {subscription.nextDeliveryDate === null
                            ? t('commerce:subscriptions.noNextDelivery')
                            : t('commerce:subscriptions.nextDelivery', {
                                  date: formatter.formatDate(subscription.nextDeliveryDate, {
                                      dateStyle: 'full',
                                  }),
                              })}
                    </Text>
                </Stack>
            </Card>

            <Inline space="sm" wrap testID="configurator-success-actions">
                <Button
                    testID="configurator-success-open"
                    label={t('commerce:configurator.successOpen')}
                    onPress={onOpen}
                />
                <Button
                    testID="configurator-success-list"
                    variant="secondary"
                    label={t('commerce:configurator.successList')}
                    onPress={onList}
                />
            </Inline>
        </Stack>
    );
}
