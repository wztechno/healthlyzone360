import {
    Button,
    EmptyState,
    Icon,
    Stack,
    StepProgress,
    useBreakpoint,
} from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    SubscriptionRefusal,
} from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import type { AllergenCode, PlanVariantId } from '@healthy360/domain-types';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import {
    toFailure,
    useAllowedDeliveryWeekdaysQuery,
    useCreateSubscriptionMutation,
    useSubscriptionPreviewQuery,
} from '../../../data/commerce-hooks.ts';
import { useAccountChecklistQuery, useAddressesQuery } from '../../../data/account-hooks.ts';
import { useCurrentTargetsQuery, useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { queryKeys } from '../../../data/query-keys.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useNavigateUp, usePreviousEntry } from '../../../navigation/use-return-to.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import {
    AccountSetupPanel,
    AccountSetupSteps,
    stepForRequirement,
} from '../../account/account-setup-steps.tsx';
import type { AccountSetupStep } from '../../account/account-setup-steps.tsx';
import { ListingHeader } from '../../../ui/listing-header.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { EMPTY_ADDRESS, toDeliveryAddress } from '../address.ts';
import {
    CONFIGURATOR_PATH,
    configuratorDraftKey,
    configuratorDrafts,
    configuratorHref,
    configuratorStepOf,
    editsOf,
    readConfiguratorLocation,
} from '../configurator-draft.ts';
import type { ConfiguratorEdits } from '../configurator-draft.ts';
import {
    DeliveryStep,
    PlanStep,
    ReviewStep,
    TermsAcknowledgement,
} from '../configurator-steps.tsx';
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    firstIncompleteStep,
    initialConfiguratorState,
    isStepReachable,
    mealCombinations,
    nextConfiguratorStep,
    previousConfiguratorStep,
    savedAddressValues,
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
import { servedAreas } from '../delivery.ts';
import type { DeliveryAreaStatus } from '../delivery.ts';
import { PlanSetupSummary } from '../plan-setup-summary.tsx';

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
 *
 * ## Nothing here lives only in component memory
 *
 * The customer area is one `<Slot/>`: adding an address, Back, a refresh or a crumb unmounts this
 * screen, and it used to come back on step one with every choice gone (plans-03). The step, the band
 * and the chosen address are in the URL (`?step=plan|delivery|review&variant=&address=`); the rest
 * of the person's changes are in a session draft keyed by plan (`../configurator-draft.ts`). So
 * Continue and Edit *push* a step — Back walks Review → Delivery → Plan — a detour comes back to the
 * step it left with everything in place, and a refresh changes nothing.
 *
 * ## The account is checked before step one, not after step three
 *
 * The account checklist is read up front. The steps a new account still has to do are listed above
 * the set-up, each opening the screen that does it and coming back here (`returnTo`), and Subscribe
 * waits until none is left — the same rule the checkout's Place order follows. The server's refusal
 * stays as the backstop for a race.
 *
 * ## Creating replaces the set-up
 *
 * A created subscription is `/customer/subscriptions/{id}?created=1`, reached by `replace`, so
 * refresh shows the subscription and Back never offers a spent set-up ready to create a second one
 * (plans-04).
 */

export interface SubscriptionConfiguratorScreenProps {
    readonly planId: string | undefined;
    /** The band the plan page was showing. `?variant=` wins once the person changes it here. */
    readonly variantId?: string | undefined;
}

export function SubscriptionConfiguratorScreen({
    planId,
    variantId: variantProp,
}: SubscriptionConfiguratorScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const queryClient = useQueryClient();
    const { atLeast } = useBreakpoint();
    const validationTranslate = useValidationTranslate();
    const navigateUp = useNavigateUp();
    const previous = usePreviousEntry();
    const params = useLocalSearchParams();
    // Memoised on the params so the compiler sees a frozen value: read inline, the location is a
    // fresh object it cannot prove unmutated, and every memo below that reads the band bails out.
    const location = useMemo(() => readConfiguratorLocation(params), [params]);
    // The route hands `plan` and `variant` over as props; the query is read here as well, so a band
    // chosen on the first step — a `setParams` — is seen without a remount.
    const variantId = location.variant ?? variantProp;
    const requestedStep: ConfiguratorStep = location.step ?? 'plan';

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

    const [showIssues, setShowIssues] = useState(false);
    const [termsAcknowledged, setTermsAcknowledged] = useState(false);

    const addresses = useAddressesQuery();
    // Memoised rather than `?? []` inline: the fallback allocates a fresh array on every render,
    // which would change the identity of every `useMemo` below that depends on this list.
    const addressList = useMemo<readonly CustomerAddress[]>(
        () => addresses.data ?? [],
        [addresses.data],
    );
    const checklist = useAccountChecklistQuery();

    /*
     * The address is the one in the URL while it is still in the book — the address editor comes
     * back with `?address=<new id>` — else the default, else the only one there is: somebody with
     * one address is never made to open a list of one to pick it. The checkout's rule (HA-22).
     */
    const addressId =
        (location.address !== undefined &&
        addressList.some((entry) => entry.id === location.address)
            ? location.address
            : null) ??
        addressList.find((entry) => entry.isDefault)?.id ??
        (addressList.length === 1 ? (addressList[0]?.id ?? null) : null);
    const savedAddress = addressList.find((entry) => entry.id === addressId);

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
     *
     * ## And the edits outlive the screen
     *
     * They start from this plan's session draft and are written back to it whenever the person
     * changes something, so a detour, Back or a refresh finds them where they were left. Only a
     * change the person made writes — opening the page over a restored draft does not renew its age.
     */
    const draftKey = configuratorDraftKey(planId ?? '');
    const [edits, setEdits] = useState<ConfiguratorEdits>(
        () => configuratorDrafts.read(draftKey) ?? {},
    );
    const changed = useRef(false);
    useEffect(() => {
        if (changed.current) configuratorDrafts.write(draftKey, edits);
    }, [draftKey, edits]);

    /**
     * One step's change, sent where it lives: the band to the URL (it is what the plan crumb and the
     * plan page share), the terms tick to this mount only, the rest to the draft — merged against the
     * latest edits rather than the rendered snapshot, so two changes in one batch both survive.
     */
    const patch = useCallback(
        (next: Partial<ConfiguratorState>) => {
            if (next.variantId !== undefined && next.variantId !== null) {
                router.setParams({ variant: String(next.variantId) } as never);
            }
            if (next.termsAcknowledged !== undefined) setTermsAcknowledged(next.termsAcknowledged);
            const draftPart = editsOf(next);
            if (Object.keys(draftPart).length === 0) return;
            changed.current = true;
            setEdits((current) => ({ ...current, ...draftPart }));
        },
        [router, setEdits, setTermsAcknowledged],
    );

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
    // so choosing an address or a window does not re-run seven requests.
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
        () =>
            defaults === null
                ? null
                : {
                      ...defaults,
                      ...edits,
                      termsAcknowledged,
                      address:
                          savedAddress === undefined
                              ? EMPTY_ADDRESS
                              : savedAddressValues(savedAddress),
                  },
        [defaults, edits, savedAddress, termsAcknowledged],
    );

    /* ── derived ─────────────────────────────────────────────────────────────────────────────── */

    const variant =
        item === undefined || state === null ? null : variantById(item, state.variantId);

    // A saved address carries the server's own answer, computed against the published zone
    // coverage — authoritative over any client-side comparison of area strings, whose
    // granularities (gazetteer rows vs a zone's display label) need not match textually.
    const areaStatus: DeliveryAreaStatus =
        savedAddress === undefined ? 'unknown' : savedAddress.isDeliverable ? 'served' : 'unserved';

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
            hasSavedAddress: savedAddress !== undefined,
            earliestStartDate: earliestStartDate(),
            storedAllergens,
            translate: (key: string) => validationTranslate(key),
        };
    }, [allowedWeekdays, areaStatus, item, savedAddress, storedAllergens, validationTranslate]);

    /*
     * The step is `?step=`, honoured only while every step before it is satisfied. A link, a stale
     * Back or an expired draft can name a step whose earlier answers are no longer there — Review
     * with no address — and that entry is moved, in place, to the first step still unanswered.
     *
     * Only once what the rules read has *settled*: the plan, the weekdays it delivers on, the stored
     * allergies, and an address book that is not fetching at all. Coming back from adding an
     * address, the book is refetched on remount, and judging `?address=` against the copy from
     * before the detour would throw the person off the step they were on.
     */
    const settled =
        item !== undefined &&
        weekdays.isFetched &&
        targets.isFetched &&
        addresses.isFetched &&
        !addresses.isFetching;
    const reachable =
        state !== null && context !== null && isStepReachable(requestedStep, state, context);
    const fallbackStep: ConfiguratorStep =
        state === null || context === null
            ? 'plan'
            : (firstIncompleteStep(state, context) ?? requestedStep);
    const step: ConfiguratorStep = reachable || !settled ? requestedStep : fallbackStep;
    const strandedOn = settled && !reachable ? fallbackStep : null;
    useEffect(() => {
        if (strandedOn === null) return;
        router.setParams({ step: strandedOn === 'plan' ? undefined : strandedOn } as never);
    }, [router, strandedOn]);

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

    /*
     * Account set-up the server still needs, read before step one rather than discovered at
     * Subscribe: one row per required step, each opening the screen that does it and coming back
     * here. Subscribe waits until the list is empty — the checkout's rule.
     */
    const setupSteps: AccountSetupStep[] = [];
    for (const entry of checklist.data?.items ?? []) {
        if (!entry.required || entry.complete) continue;
        setupSteps.push({
            step: entry.step,
            blockedReason: entry.blockedReason,
            ...(entry.step === 'add_address' ? { hasAddress: addressList.length > 0 } : {}),
        });
    }

    /* ── navigation ──────────────────────────────────────────────────────────────────────────── */

    /** This set-up at a step, as it stands — what a step change pushes and a detour returns to. */
    const hrefAt = (target: ConfiguratorStep, address: string | null = addressId): string =>
        configuratorHref({
            plan: planId,
            variant: state?.variantId ?? variantId,
            step: target,
            address: address ?? undefined,
        });
    const here = hrefAt(step);

    // A step of its own in history, so Back walks the steps rather than leaving the set-up.
    const goTo = (target: ConfiguratorStep) => {
        setShowIssues(false);
        router.push(hrefAt(target) as never);
    };

    const onBack = () => {
        const target = previousConfiguratorStep(step);
        if (target === null) return;
        setShowIssues(false);
        // Back when the step before is the entry underneath — the usual case, since Continue pushed
        // this one; otherwise (a refresh, a link) the step is changed in place, so the in-card Back
        // never leaves the set-up.
        if (
            previous !== null &&
            previous.pathname === CONFIGURATOR_PATH &&
            (configuratorStepOf(previous.params['step']) ?? 'plan') === target
        ) {
            router.back();
        } else {
            router.setParams({ step: target === 'plan' ? undefined : target } as never);
        }
    };

    const onNext = () => {
        if (state === null || context === null) return;
        if (validateConfiguratorStep(step, state, context).length > 0) {
            setShowIssues(true);
            return;
        }
        const target = nextConfiguratorStep(step);
        if (target !== null) goTo(target);
    };

    // The draft is written as each change is made, so leaving now loses nothing; the editor comes
    // back to the delivery step with the new address in `?address=`.
    const onAddAddress = () => {
        router.push(
            withReturnTo('/customer/account/addresses/new', hrefAt('delivery', null)) as never,
        );
    };

    const hasDraft = Object.keys(edits).length > 0;
    const startOver = () => {
        configuratorDrafts.clear(draftKey);
        changed.current = false;
        setEdits({});
        setTermsAcknowledged(false);
        setShowIssues(false);
        router.setParams({ step: undefined, address: undefined } as never);
    };

    const onCreate = () => {
        if (state === null || item === undefined || context === null) return;
        if (setupSteps.length > 0) return;
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
            {
                onSuccess: (subscription) => {
                    configuratorDrafts.clear(draftKey);
                    // Replaces the set-up: the new subscription has a URL of its own, a refresh
                    // shows it, and Back is not a second chance to create it (plans-04).
                    router.replace(
                        withQuery(`/customer/subscriptions/${String(subscription.id)}`, {
                            created: '1',
                        }) as never,
                    );
                },
                onError: () => {
                    // A set-up refusal means the checklist read earlier is out of date.
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.account.checklist(),
                    });
                },
            },
        );
    };

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
                // Up to the listing as the person left it, and to the plan on the band chosen here —
                // not to a bare path that resets both (browse-05). The draft keeps the set-up.
                breadcrumbs={[
                    {
                        key: 'plans',
                        label: t('catalogue:nav.plans'),
                        onPress: () => {
                            navigateUp('/plans');
                        },
                    },
                    ...(item === undefined
                        ? []
                        : [
                              {
                                  key: 'plan',
                                  label: item.name,
                                  onPress: () => {
                                      navigateUp(
                                          withQuery(`/plans/${String(item.id)}`, {
                                              variant: state?.variantId ?? variantId,
                                          }),
                                      );
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
                            {setupSteps.length === 0 ? null : (
                                <View className="mb-6">
                                    <AccountSetupPanel
                                        testID="configurator-setup-required"
                                        title={t('commerce:configurator.setupTitle')}
                                        body={t('commerce:configurator.setupBody', {
                                            count: setupSteps.length,
                                        })}
                                        steps={setupSteps}
                                        stepsTestID="configurator-setup-step"
                                        returnTo={here}
                                    />
                                </View>
                            )}
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
                                    allowedWeekdays={allowedWeekdays}
                                    areaStatus={areaStatus}
                                    servedAreas={areas}
                                    allergenOptions={allergenOptions}
                                    storedAllergens={storedAllergens}
                                    showIssues={showIssues}
                                    savedAddresses={addressList}
                                    addressId={addressId}
                                    onAddressIdChange={(next) => {
                                        router.setParams({ address: next ?? undefined } as never);
                                    }}
                                    onAddAddress={onAddAddress}
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

                            {previousConfiguratorStep(step) === null && !hasDraft ? null : (
                                <View className="mt-5 flex-row flex-wrap items-center gap-2 self-start">
                                    {previousConfiguratorStep(step) === null ? null : (
                                        <Button
                                            testID="configurator-back"
                                            variant="quiet"
                                            label={t('commerce:configurator.back')}
                                            onPress={onBack}
                                        />
                                    )}
                                    {/* Quiet, and only once there is something to discard: the
                                        remembered choices are the point, and forgetting them is
                                        the exception. */}
                                    {hasDraft ? (
                                        <Button
                                            testID="configurator-start-over"
                                            variant="quiet"
                                            label={t('commerce:configurator.startOver')}
                                            onPress={startOver}
                                        />
                                    ) : null}
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
                                // Next waits for what the step rules read (the plan's delivery
                                // days, stored allergies, the address book): a step taken before
                                // they arrive could be judged unreachable a moment later and
                                // silently put back.
                                actionLoading={step === 'review' ? create.isPending : !settled}
                                actionDisabled={step === 'review' && setupSteps.length > 0}
                                {...(step === 'review' && setupSteps.length > 0
                                    ? {
                                          actionHint: t(
                                              'commerce:configurator.subscribeBlockedHint',
                                          ),
                                      }
                                    : {})}
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
                                        returnTo={here}
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
    returnTo,
}: {
    readonly issues: readonly string[];
    readonly failure: string | null;
    readonly reasons: readonly SubscriptionRefusal[];
    /** The set-up on its current step, which each account step comes back to. */
    readonly returnTo: string;
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
                        <AccountSetupSteps
                            steps={setupSteps}
                            returnTo={returnTo}
                            testID="configurator-refusal-step"
                        />
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
