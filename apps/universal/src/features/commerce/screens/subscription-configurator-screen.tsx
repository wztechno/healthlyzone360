import {
    Button,
    Callout,
    Card,
    EmptyState,
    Heading,
    Inline,
    Stack,
    Stepper,
    Text,
} from '@healthy360/design-system';
import type {
    MarketplaceMeal,
    Subscription,
    CustomerAddress,
} from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import type { AllergenCode, PlanVariantId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { EMPTY_ADDRESS, toDeliveryAddress, validateAddress } from '../address.ts';
import type { AddressField } from '../address.ts';
import {
    CombinationStep,
    ConfirmStep,
    DeliveryStep,
    DietaryStep,
    DurationStep,
    MealsStep,
    PlanStep,
    SummaryStep,
} from '../configurator-steps.tsx';
import {
    CONFIGURATOR_STEP_COUNT,
    combinationKey,
    initialConfiguratorState,
    isBeforePriceStep,
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
import { SubscriptionStateBadge } from '../state-badge.tsx';

/**
 * `/customer/subscriptions/new?plan={id}` — the eight-step subscription configurator.
 *
 * ## Deliberately longer than the reference, for exactly two reasons
 *
 * Doc 11 records the reference product's whole pre-purchase configuration as three decisions on one
 * page (`SUB-01`, `SUB-03`), and doc 17 `SUB-01` agrees that configuration should be short. Ours is
 * eight steps because two of the questions the reference defers past payment — *do you deliver
 * here?* (`DEF-04`) and *what must be excluded?* (`DEF-06`) — are asked here, before the price. Doc
 * 17 `SUB-02` marks that divergence as important: both are cheap to ask, both are dispositive, and
 * neither is a question anybody wants answered after paying.
 *
 * The ordering is enforced structurally rather than by convention. Steps one to six never receive
 * the preview, so they *cannot* show a price; `useSubscriptionPreviewQuery` is only enabled from
 * the summary step onwards.
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
    const formatter = useFormatter();
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

    const areaStatus = useMemo(() => {
        const selected = addressList.find((entry) => entry.id === addressId);
        const area = selected?.areaName ?? state?.address.area ?? '';
        return deliveryAreaStatus(kitchen.data, area);
    }, [addressId, addressList, kitchen.data, state?.address.area]);

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
            earliestStartDate: earliestStartDate(),
            translate: (key: string) => validationTranslate(key),
        };
    }, [allowedWeekdays, areaStatus, item, validationTranslate]);

    const issues =
        state === null || context === null ? [] : validateConfiguratorStep(step, state, context);

    // The structural guarantee behind the SUB-02 ordering: no configuration reaches the preview
    // until the summary step, so nothing before it can render a price even by accident.
    const configuration = useMemo(() => {
        if (item === undefined || state === null) return null;
        if (step !== 'summary' && step !== 'confirm') return null;
        return toConfiguration(state, item, (values) => toDeliveryAddress(values));
    }, [item, state, step]);

    const preview = useSubscriptionPreviewQuery(configuration);
    const create = useCreateSubscriptionMutation();
    const createFailure = toFailure(create.error);

    /* ── navigation ──────────────────────────────────────────────────────────────────────────── */

    const onBack = useCallback(() => {
        const target = previousConfiguratorStep(step);
        if (target !== null) {
            setShowIssues(false);
            setStep(target);
        }
    }, [step]);

    const onNext = useCallback(() => {
        if (state === null || context === null) return;
        if (validateConfiguratorStep(step, state, context).length > 0) {
            setShowIssues(true);
            return;
        }
        const target = nextConfiguratorStep(step);
        if (target === null) return;
        setShowIssues(false);
        setStep(target);
    }, [context, state, step]);

    const onCreate = useCallback(() => {
        if (state === null || item === undefined || context === null) return;
        if (validateConfiguratorStep('confirm', state, context).length > 0) {
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
                    router.replace('/customer/subscriptions' as never);
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

    return (
        <Stack space="lg" testID="configurator-screen">
            <Stack space="xs">
                <Heading level={1} testID="configurator-title">
                    {t('commerce:configurator.title')}
                </Heading>
                <Text tone="secondary">{t('commerce:configurator.body')}</Text>
            </Stack>

            <Stepper
                testID="configurator-stepper"
                label={t('commerce:configurator.progressLabel')}
                current={stepPosition(step)}
                total={CONFIGURATOR_STEP_COUNT}
                stepLabel={t(`commerce:configurator.steps.${step}`)}
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
                    <Stack space="lg">
                        {step === 'plan' ? (
                            <PlanStep plan={item} variant={variant} state={state} patch={patch} />
                        ) : null}

                        {step === 'combination' ? (
                            <CombinationStep
                                plan={item}
                                variant={variant}
                                onSelect={(key) => {
                                    const combination = mealCombinations(item).find(
                                        (option) => combinationKey(option) === key,
                                    );
                                    if (combination === undefined) return;
                                    const next = variantForCombination(item, combination, variant);
                                    if (next !== null) patch({ variantId: next.id });
                                }}
                            />
                        ) : null}

                        {step === 'duration' ? (
                            <DurationStep
                                plan={item}
                                variant={variant}
                                state={state}
                                patch={patch}
                            />
                        ) : null}

                        {step === 'dietary' ? (
                            <DietaryStep
                                plan={item}
                                state={state}
                                patch={patch}
                                allergenOptions={allergenOptions}
                                storedAllergens={storedAllergens}
                                restrictionsPending={targets.isPending}
                            />
                        ) : null}

                        {step === 'delivery' ? (
                            <DeliveryStep
                                state={state}
                                patch={patch}
                                onAddressField={patchAddressField}
                                allowedWeekdays={allowedWeekdays}
                                weekdaysPending={weekdays.isPending}
                                areaStatus={areaStatus}
                                servedAreas={areas}
                                addressErrors={addressErrors}
                                storedAllergens={storedAllergens}
                                showIssues={showIssues}
                                savedAddresses={addressList}
                                addressId={addressId}
                                addressesPending={addresses.isPending}
                                onAddressIdChange={setAddressId}
                            />
                        ) : null}

                        {step === 'meals' ? (
                            <MealsStep
                                plan={item}
                                state={state}
                                patch={patch}
                                menu={menu}
                                menuPending={menuQuery.isPending}
                            />
                        ) : null}

                        {step === 'summary' ? (
                            <QueryStates
                                query={preview}
                                isEmpty={preview.data === undefined}
                                emptyTitle={t('commerce:configurator.previewEmptyTitle')}
                                emptyBody={t('commerce:configurator.previewEmptyBody')}
                                skeletonCount={2}
                                testID="configurator-preview"
                            >
                                <SummaryStep plan={item} state={state} preview={preview.data} />
                            </QueryStates>
                        ) : null}

                        {step === 'confirm' ? (
                            <ConfirmStep
                                plan={item}
                                state={state}
                                patch={patch}
                                preview={preview.data}
                                showIssues={showIssues}
                            />
                        ) : null}

                        {showIssues && issues.length > 0 ? (
                            <Callout
                                testID="configurator-issues"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('commerce:configurator.issuesTitle')}
                            >
                                <Stack space="none">
                                    {issues.map((key) => (
                                        <Text
                                            key={key}
                                            testID={`configurator-issue-${key.split('.').pop() ?? key}`}
                                        >
                                            {t(key)}
                                        </Text>
                                    ))}
                                </Stack>
                            </Callout>
                        ) : null}

                        {createFailure === null ? null : (
                            <Callout
                                testID="configurator-create-error"
                                role="alert"
                                tone="danger"
                                title={t('commerce:configurator.createFailedTitle')}
                                body={createFailure.message}
                            />
                        )}

                        <Inline space="sm" wrap testID="configurator-navigation">
                            <Button
                                testID="configurator-back"
                                variant="secondary"
                                label={t('commerce:configurator.back')}
                                disabled={previousConfiguratorStep(step) === null}
                                onPress={onBack}
                            />
                            {step === 'confirm' ? (
                                <Button
                                    testID="configurator-create"
                                    label={t('commerce:configurator.create')}
                                    loading={create.isPending}
                                    onPress={onCreate}
                                />
                            ) : (
                                <Button
                                    testID="configurator-next"
                                    label={t('commerce:configurator.next')}
                                    onPress={onNext}
                                />
                            )}
                            <Text tone="secondary" variant="caption" testID="configurator-position">
                                {t('commerce:configurator.position', {
                                    current: formatter.formatNumber(stepPosition(step)),
                                    total: formatter.formatNumber(CONFIGURATOR_STEP_COUNT),
                                })}
                            </Text>
                        </Inline>

                        {/* The price is not on this screen until step seven, and this line says why
                            rather than leaving somebody hunting for a total. */}
                        {isBeforePriceStep(step) ? (
                            <Text
                                tone="secondary"
                                variant="caption"
                                testID="configurator-price-later"
                            >
                                {t('commerce:configurator.priceLater')}
                            </Text>
                        ) : null}
                    </Stack>
                )}
            </QueryStates>
        </Stack>
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
                    <Text tone="secondary" variant="caption">
                        {t('commerce:configurator.successNoPayment')}
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
