import { HideShellTopbar, Icon, Stack, cx, useBreakpoint } from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    SubscriptionRefusal,
} from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import type { PlanVariantId } from '@healthy360/domain-types';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import {
    toFailure,
    useCreateSubscriptionMutation,
    usePlanAvailabilityQuery,
    useSubscriptionPreviewQuery,
} from '../../../data/commerce-hooks.ts';
import { useAccountChecklistQuery, useAddressesQuery } from '../../../data/account-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
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
import { listDayPrice } from '../../catalogue/plan-balance.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ShopStateButton, ShopStateCard } from '../../../ui/shop-state.tsx';
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
    bandLabel,
    mealsLine,
    slotName,
} from '../configurator-steps.tsx';
import type { PayMethod } from '../configurator-steps.tsx';
import {
    CONFIGURATOR_STEPS,
    combinationKey,
    configuredDeliveryDates,
    durationOption,
    estimatedTotal,
    firstIncompleteStep,
    initialConfiguratorState,
    isStepReachable,
    mealCombinations,
    missingPicks,
    nextConfiguratorStep,
    chosenDays,
    pickedMealIds,
    previousConfiguratorStep,
    savedAddressValues,
    sittingsOf,
    stepPosition,
    toConfiguration,
    validateConfiguratorStep,
    variantById,
    variantForCombination,
} from '../configurator.ts';
import type { ConfiguratorState, ConfiguratorStep, StepContext } from '../configurator.ts';
import { earliestStartDate, nextAllowedDate } from '../dates.ts';
import { defaultSlotCode, deliverySlotsForKitchen, servedAreas } from '../delivery.ts';
import type { DeliveryAreaStatus } from '../delivery.ts';
import { MealsStep } from '../plan-meal-picker.tsx';
import { SetupBand, SetupStepper } from '../plan-setup-frame.tsx';
import { PlanSetupSummary } from '../plan-setup-summary.tsx';

/**
 * `/customer/subscriptions/new?plan={id}` — setting up a subscription, in four steps.
 *
 * ① **Plan** — calorie band, meals a day, length. ② **Delivery** — days, start, window, address,
 * and the allergy list the kitchen will read. ③ **Meals** — a dish for every sitting of every
 * delivery day, from any meal the kitchen publishes; the customer decides what they eat, and
 * Subscribe waits until every day is filled. ④ **Review** — the choices with an Edit back to each,
 * the server's price and the terms. `configurator.ts` holds the rules.
 *
 * Drawn as the accepted "Plan setup" board: the canopy band with the plan's chips, the stepper card
 * over its foot, the step's pane, and beside it from `lg` the "Your plan" summary with Back and the
 * button that moves on (a bar pinned to the foot of the page below `lg`). The price is there from
 * the first step — an estimate until the review step has the server's preview. Booking ends on the
 * board's "Your plan is booked".
 *
 * ## The confirm step is real
 *
 * `createSubscription` exists, the prototype world stores the result, and the subscription that
 * appears on `/customer/subscriptions` afterwards is the one this screen made. No payment is taken,
 * because the contract has no method that could take one.
 *
 * ## What the configurator has to discover rather than read
 *
 * A plan's delivery weekdays and its change cut-off are not on `SubscriptionPlan`, so they are
 * read from the quote (`usePlanAvailabilityQuery`). Together they fix the earliest start date:
 * the first delivery weekday on or after the cut-off, which is the date the kitchen would start
 * on anyway. Offering an earlier one meant the summary promised a date the subscription then
 * silently did not keep (plans-17).
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
 * A created subscription is `/customer/subscriptions/{id}?created=1`, reached from the booked panel
 * by `replace`, so refresh shows the subscription and Back never offers a spent set-up ready to
 * create a second one (plans-04).
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
    const formatter = useFormatter();
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
    const menuQuery = useMealsQuery(
        item === undefined
            ? undefined
            : { kitchenIds: [item.kitchenId], itemTypes: ['meal'], limit: 50 },
        item !== undefined,
    );
    const menu: readonly MarketplaceMeal[] = mealsFromPages(menuQuery.data?.pages);
    // Every dish the kitchen publishes is a choice, so the whole menu is read, a page at a time.
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = menuQuery;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
    const menuLoaded = menuQuery.isFetched && !hasNextPage;

    const [showIssues, setShowIssues] = useState(false);
    const [termsAcknowledged, setTermsAcknowledged] = useState(false);
    // How the person means to pay. Shown only: the plan purchase takes no payment yet.
    const [pay, setPay] = useState<PayMethod>('cash');

    // The kitchen's own delivery windows — Breakfast, Lunch, Snack, Dinner — as the shop offers them.
    const slots = useMemo(() => deliverySlotsForKitchen(kitchen.data), [kitchen.data]);

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

    /* ── the availability probe, and the defaults it feeds ─────────────────────────────────── */

    // A probe configuration exists as soon as the plan does. Its delivery weekdays and start are
    // irrelevant — the quote is keyed by the plan, the band and the length — so choosing an
    // address or a window does not re-run it.
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

    const availability = usePlanAvailabilityQuery(probe);
    const allowedWeekdays: readonly number[] | null = availability.data?.availableWeekdays ?? null;
    const cutoffHours = availability.data?.changeCutoffHours ?? 0;

    // The days the person is choosing: their own once they have touched them, else every day
    // the plan delivers on (the default below).
    const chosenWeekdays = edits.deliveryWeekdays ?? allowedWeekdays ?? undefined;

    // The first day the kitchen can start on *those* days, as the server walks it — the floor the
    // purchase enforces with a 422 rather than moving the start (plans-17). Until it answers, the
    // same rule worked out here: past the cut-off, on a chosen day.
    const startFloor = usePlanAvailabilityQuery(probe, chosenWeekdays);
    const earliest = useMemo(() => {
        const server = startFloor.data?.earliestStartDate ?? null;
        if (server !== null) return server;
        const floor = earliestStartDate(new Date(), cutoffHours);
        const days =
            chosenWeekdays === undefined || chosenWeekdays.length === 0 ? null : chosenWeekdays;
        return days === null ? floor : (nextAllowedDate(floor, days) ?? floor);
    }, [chosenWeekdays, cutoffHours, startFloor.data]);

    const defaults = useMemo<ConfiguratorState | null>(() => {
        if (item === undefined) return null;
        return initialConfiguratorState({
            plan: item,
            variantId: variantId === undefined ? null : (variantId as PlanVariantId),
            startDate: earliest,
            // Every day the plan can deliver on, pre-selected: the common case is "all of them", and
            // removing a few is a smaller job than choosing from nothing.
            ...(allowedWeekdays === null ? {} : { allowedWeekdays }),
        });
    }, [allowedWeekdays, earliest, item, variantId]);

    const state = useMemo<ConfiguratorState | null>(
        () =>
            defaults === null
                ? null
                : {
                      ...defaults,
                      ...edits,
                      slotCode: slots.some(
                          (slot) => slot.code === (edits.slotCode ?? defaults.slotCode),
                      )
                          ? (edits.slotCode ?? defaults.slotCode)
                          : (defaultSlotCode(slots) ?? defaults.slotCode),
                      termsAcknowledged,
                      address:
                          savedAddress === undefined
                              ? EMPTY_ADDRESS
                              : savedAddressValues(savedAddress),
                  },
        [defaults, edits, savedAddress, slots, termsAcknowledged],
    );

    /* ── derived ─────────────────────────────────────────────────────────────────────────────── */

    const variant =
        item === undefined || state === null ? null : variantById(item, state.variantId);

    // The dishes picked so far: what the allergy notice checks against the person's list.
    const chosenMeals = useMemo<readonly MarketplaceMeal[]>(() => {
        if (item === undefined || state === null) return [];
        const ids = new Set(pickedMealIds(state, item).map(String));
        return menu.filter((meal) => ids.has(String(meal.id)));
    }, [item, menu, state]);

    // The days each picked dish lands on, for the allergy card's "Wed 11 Nov · 3 days".
    const pickedDates = useMemo(() => {
        const byMeal = new Map<string, string[]>();
        if (item === undefined || state === null) return byMeal;
        for (const day of chosenDays(state, item)) {
            for (const meal of day.meals) {
                const key = String(meal.mealId);
                byMeal.set(key, [...(byMeal.get(key) ?? []), day.date]);
            }
        }
        return byMeal;
    }, [item, state]);
    const whenPicked = (meal: MarketplaceMeal): string | undefined => {
        const [first, ...rest] = pickedDates.get(String(meal.id)) ?? [];
        if (first === undefined) return undefined;
        const date = formatter.formatDate(`${first}T12:00:00Z`, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        });
        return rest.length === 0
            ? date
            : t('commerce:myAllergens.pickedOnMore', { date, count: rest.length });
    };

    // A saved address carries the server's own answer, computed against the published zone
    // coverage — authoritative over any client-side comparison of area strings, whose
    // granularities (gazetteer rows vs a zone's display label) need not match textually.
    const areaStatus: DeliveryAreaStatus =
        savedAddress === undefined ? 'unknown' : savedAddress.isDeliverable ? 'served' : 'unserved';

    const areas = useMemo(() => servedAreas(kitchen.data), [kitchen.data]);

    const context = useMemo<StepContext | null>(() => {
        if (item === undefined) return null;
        return {
            plan: item,
            allowedWeekdays,
            areaStatus,
            hasSavedAddress: savedAddress !== undefined,
            earliestStartDate: earliest,
            slotCodes: slots.map((slot) => slot.code),
            translate: (key: string) => validationTranslate(key),
        };
    }, [allowedWeekdays, areaStatus, earliest, item, savedAddress, slots, validationTranslate]);

    /*
     * The step is `?step=`, honoured only while every step before it is satisfied. A link, a stale
     * Back or an expired draft can name a step whose earlier answers are no longer there — Review
     * with no address — and that entry is moved, in place, to the first step still unanswered.
     *
     * Only once what the rules read has *settled*: the plan, the days it delivers on, and an
     * address book that is not fetching at all. Coming back from adding an address, the book is
     * refetched on remount, and judging `?address=` against the copy from before the detour would
     * throw the person off the step they were on.
     */
    // A plan with no length on sale has nothing to quote, so it never waits on the quote: its
    // plan step then says so rather than spinning on a request that is never made.
    const settled =
        item !== undefined &&
        (item.durations.length === 0 || availability.isFetched) &&
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
     * Once created, the step gives way to the board's "Your plan is booked": the plan and its start,
     * "See my plan" (the new subscription, by `replace`, so Back is not a second chance to create it —
     * plans-04) and "Back to plans".
     */
    const [booked, setBooked] = useState<{ readonly href: string } | null>(null);

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
                    setBooked({
                        href: withQuery(`/customer/subscriptions/${String(subscription.id)}`, {
                            created: '1',
                        }),
                    });
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
        <ShopStateButton
            testID="configurator-browse"
            icon="arrowForward"
            iconAfter
            label={t('commerce:configurator.browsePlans')}
            onPress={() => {
                router.push('/plans');
            }}
        />
    );

    if (parsedPlanId === null) {
        return (
            <Stack space="lg" testID="configurator-screen">
                <ShopStateCard
                    testID="configurator-empty"
                    icon="calendar"
                    title={t('commerce:configurator.notFoundTitle')}
                    body={t('commerce:configurator.notFoundBody')}
                    actions={browseAction}
                />
            </Stack>
        );
    }

    const current = stepPosition(step) - 1;
    const wide = atLeast('lg');
    const phone = !atLeast('md');
    const dash = '—';

    // What the band, the stepper and the summary say about the set-up so far.
    const option =
        item === undefined || state === null ? undefined : durationOption(item, state.duration);
    const dates = item === undefined || state === null ? [] : configuredDeliveryDates(state, item);
    const slotsPerDay = item === undefined || state === null ? 0 : sittingsOf(item, state).length;
    const totalSlots = dates.length * slotsPerDay;
    const picked =
        item === undefined || state === null ? 0 : totalSlots - missingPicks(state, item);
    const chosenSlot =
        state === null ? undefined : slots.find((slot) => slot.code === state.slotCode);
    const windowLabel =
        state === null || chosenSlot === undefined
            ? null
            : slotName(chosenSlot, chosenSlot.code, t);
    const startLabel =
        state === null || state.startDate === null
            ? null
            : formatter.formatDate(`${state.startDate}T12:00:00Z`, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
              });
    const total =
        preview.data?.total ?? (variant === null ? null : estimatedTotal(variant, option));
    const addressLabel =
        savedAddress === undefined
            ? null
            : savedAddress.label.trim() === ''
              ? savedAddress.areaName
              : savedAddress.label;

    const stepSub: Record<ConfiguratorStep, string> = {
        plan: item?.name ?? dash,
        delivery:
            addressLabel === null && windowLabel === null
                ? dash
                : [addressLabel, windowLabel].filter((part) => part !== null).join(' · '),
        meals: t('commerce:configurator.summary.mealsOf', {
            done: formatter.formatNumber(picked),
            total: formatter.formatNumber(totalSlots),
        }),
        review: total === null ? dash : formatMoney(formatter, total),
    };

    const nextLabel: Record<ConfiguratorStep, string> = {
        plan: t('commerce:configurator.nextTo.delivery'),
        delivery: t('commerce:configurator.nextTo.meals'),
        meals: t('commerce:configurator.nextTo.review'),
        review: t('commerce:configurator.placeOrder'),
    };

    return (
        <View testID="configurator-screen" className="flex-col pb-10">
            <QueryStates
                query={plan}
                isEmpty={item === undefined}
                emptyTitle={t('commerce:configurator.notFoundTitle')}
                emptyBody={t('commerce:configurator.notFoundBody')}
                emptyActions={browseAction}
                emptyIcon="calendar"
                // A plan that is gone is the board's "We could not find that plan", not an error.
                treatFailuresAsEmpty={['resource.not_found']}
                skeleton="page"
                skeletonCount={2}
                testID="configurator"
            >
                {item === undefined || state === null ? null : (
                    <View className="flex-col">
                        {phone ? (
                            /*
                             * Shop · Plan setup, phone board: the page's own bar — Back, "Step 1 of
                             * 4" over the step's name, the plan as a chip — and a four-part progress
                             * line under it, in place of the canopy band and the stepper card.
                             */
                            <>
                                <HideShellTopbar />
                                <View
                                    testID="configurator-header"
                                    className="h-14 flex-row items-center gap-2.5 rounded-full border border-stroke-subtle bg-surface-raised pe-2 ps-1.5 shadow-elevation-3"
                                >
                                    <Pressable
                                        testID="configurator-header-back"
                                        role="link"
                                        accessibilityRole="link"
                                        accessibilityLabel={t('marketplace:nav.weeklyPlans')}
                                        onPress={() => {
                                            navigateUp('/plans');
                                        }}
                                        className="h-11 w-11 items-center justify-center rounded-full bg-surface-base"
                                    >
                                        <Icon
                                            name="chevronBackward"
                                            className="text-content-primary"
                                        />
                                    </Pressable>
                                    <View className="min-w-0 flex-1 flex-col">
                                        <RNText className="text-xs font-semibold uppercase tracking-wide text-content-secondary">
                                            {t('commerce:configurator.stepOf', {
                                                step: current + 1,
                                                total: CONFIGURATOR_STEPS.length,
                                            })}
                                        </RNText>
                                        <RNText
                                            role="heading"
                                            aria-level={1}
                                            numberOfLines={1}
                                            className="font-display text-base font-bold text-content-primary text-start"
                                        >
                                            {t(`commerce:configurator.steps.${step}`)}
                                        </RNText>
                                    </View>
                                    <View className="h-7 max-w-[140px] justify-center rounded-full bg-surface-brand-subtle px-2.5">
                                        <RNText
                                            numberOfLines={1}
                                            className="text-xs font-semibold text-content-on-brand-subtle"
                                        >
                                            {item.name}
                                        </RNText>
                                    </View>
                                </View>
                                <View
                                    testID="configurator-stepper"
                                    role="progressbar"
                                    aria-label={t('commerce:configurator.progressLabel')}
                                    className="mt-3 flex-row gap-1"
                                >
                                    {CONFIGURATOR_STEPS.map((key, index) => (
                                        <View
                                            key={key}
                                            testID={`configurator-progress-${key}`}
                                            className={cx(
                                                'h-1 flex-1 rounded-full',
                                                booked !== null || index <= current
                                                    ? 'bg-surface-brand'
                                                    : 'bg-surface-brand-subtle',
                                            )}
                                        />
                                    ))}
                                </View>
                            </>
                        ) : (
                            <>
                                <SetupBand
                                    testID="configurator-header"
                                    back={{
                                        label: t('marketplace:nav.weeklyPlans'),
                                        // Up to the listing as the person left it (browse-05). The draft
                                        // keeps the set-up.
                                        onPress: () => {
                                            navigateUp('/plans');
                                        },
                                    }}
                                    title={t('commerce:configurator.titleFor', { plan: item.name })}
                                    chips={[
                                        ...(variant === null
                                            ? []
                                            : [
                                                  t('commerce:configurator.aDay', {
                                                      value: formatMoney(
                                                          formatter,
                                                          listDayPrice(variant),
                                                      ),
                                                  }),
                                                  t('commerce:configurator.aDay', {
                                                      value: bandLabel(
                                                          variant,
                                                          formatter.formatNumber,
                                                          t,
                                                      ),
                                                  }),
                                                  mealsLine(variant, formatter.formatNumber, t),
                                              ]),
                                        ...(option === undefined
                                            ? []
                                            : [
                                                  t('catalogue:plans.finderDaysValue', {
                                                      count: option.days,
                                                  }),
                                              ]),
                                    ]}
                                />

                                <SetupStepper
                                    testID="configurator-stepper"
                                    label={t('commerce:configurator.progressLabel')}
                                    steps={CONFIGURATOR_STEPS.map((key, index) => ({
                                        key,
                                        label: t(`commerce:configurator.steps.${key}`),
                                        sub: stepSub[key],
                                        state:
                                            booked !== null || index < current
                                                ? 'done'
                                                : index === current
                                                  ? 'current'
                                                  : 'todo',
                                        locked:
                                            booked !== null ||
                                            context === null ||
                                            !isStepReachable(key, state, context),
                                        testID: `configurator-progress-${key}`,
                                    }))}
                                    onSelect={(key) => {
                                        const target = CONFIGURATOR_STEPS.find(
                                            (each) => each === key,
                                        );
                                        if (target !== undefined && target !== step) goTo(target);
                                    }}
                                />
                            </>
                        )}

                        <View
                            className={cx(
                                'flex-col gap-6 lg:flex-row lg:items-start',
                                phone ? 'mt-4' : 'mt-[22px]',
                            )}
                        >
                            <View className="min-w-0 flex-col lg:flex-1">
                                {setupSteps.length === 0 || booked !== null ? null : (
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

                                {booked !== null ? (
                                    <BookedPanel
                                        planName={item.name}
                                        startLabel={startLabel}
                                        onSeePlan={() => {
                                            router.replace(booked.href as never);
                                        }}
                                        onBackToPlans={() => {
                                            router.replace('/plans' as never);
                                        }}
                                    />
                                ) : null}

                                {booked === null && step === 'plan' ? (
                                    <PlanStep
                                        plan={item}
                                        variant={variant}
                                        state={state}
                                        patch={patch}
                                        onChangePlan={() => {
                                            navigateUp('/plans');
                                        }}
                                        onCombination={(key) => {
                                            const combination = mealCombinations(item).find(
                                                (each) => combinationKey(each) === key,
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

                                {booked === null && step === 'delivery' ? (
                                    <DeliveryStep
                                        state={state}
                                        patch={patch}
                                        allowedWeekdays={allowedWeekdays}
                                        earliestStartDate={earliest}
                                        firstStartTile={
                                            startFloor.data?.earliestStartDate ??
                                            earliestStartDate(new Date(), cutoffHours)
                                        }
                                        cutoffHours={cutoffHours}
                                        slots={slots}
                                        areaStatus={areaStatus}
                                        servedAreas={areas}
                                        chosenMeals={chosenMeals}
                                        chosenMealsLoaded={menuLoaded}
                                        whenPicked={whenPicked}
                                        returnTo={here}
                                        showIssues={showIssues}
                                        savedAddresses={addressList}
                                        addressId={addressId}
                                        onAddressIdChange={(next) => {
                                            router.setParams({
                                                address: next ?? undefined,
                                            } as never);
                                        }}
                                        onAddAddress={onAddAddress}
                                    />
                                ) : null}

                                {booked === null && step === 'meals' ? (
                                    <MealsStep
                                        plan={item}
                                        state={state}
                                        patch={patch}
                                        menu={menu}
                                        menuLoading={!menuLoaded}
                                        showIssues={showIssues}
                                    />
                                ) : null}

                                {booked === null && step === 'review' ? (
                                    <QueryStates
                                        query={preview}
                                        isEmpty={preview.data === undefined}
                                        emptyTitle={t('commerce:configurator.previewEmptyTitle')}
                                        emptyBody={t('commerce:configurator.previewEmptyBody')}
                                        emptyIcon="alert"
                                        emptyTone="warning"
                                        compact
                                        skeleton="lines"
                                        skeletonCount={2}
                                        testID="configurator-preview"
                                    >
                                        <ReviewStep
                                            plan={item}
                                            state={state}
                                            patch={patch}
                                            preview={preview.data}
                                            savedAddress={savedAddress}
                                            slots={slots}
                                            cutoffHours={cutoffHours}
                                            chosenMeals={chosenMeals}
                                            chosenMealsLoaded={menuLoaded}
                                            whenPicked={whenPicked}
                                            returnTo={here}
                                            pay={pay}
                                            onPay={setPay}
                                            showIssues={showIssues}
                                            onEdit={goTo}
                                        />
                                    </QueryStates>
                                ) : null}
                            </View>

                            {/*
                             * Sticky on the web against the shell's scroll port: beside the step from
                             * `lg`, pinned to the foot of the page below it. The wrapper sticks, not
                             * the card — a sticky box sticks within its parent.
                             */}
                            <View
                                className={
                                    wide
                                        ? 'w-[360px] flex-col web:sticky web:top-0'
                                        : 'z-10 web:sticky web:bottom-4'
                                }
                            >
                                <PlanSetupSummary
                                    plan={item}
                                    variant={variant}
                                    state={state}
                                    preview={preview.data}
                                    startLabel={startLabel}
                                    windowLabel={windowLabel}
                                    picked={picked}
                                    slots={totalSlots}
                                    showActions={booked === null}
                                    actionLabel={nextLabel[step]}
                                    actionTail={step === 'review' ? 'total' : 'arrow'}
                                    actionTestID={
                                        step === 'review'
                                            ? 'configurator-create'
                                            : 'configurator-next'
                                    }
                                    // Next waits for what the step rules read (the plan's delivery
                                    // days, stored allergies, the address book): a step taken before
                                    // they arrive could be judged unreachable a moment later and
                                    // silently put back.
                                    actionLoading={step === 'review' ? create.isPending : !settled}
                                    actionDisabled={
                                        step === 'review' &&
                                        (setupSteps.length > 0 || !state.termsAcknowledged)
                                    }
                                    {...(step === 'review' && setupSteps.length > 0
                                        ? {
                                              actionHint: t(
                                                  'commerce:configurator.subscribeBlockedHint',
                                              ),
                                          }
                                        : {})}
                                    onAction={step === 'review' ? onCreate : onNext}
                                    {...(previousConfiguratorStep(step) === null ? {} : { onBack })}
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
                                    // Quiet, and only once there is something to discard: the
                                    // remembered choices are the point, and forgetting them is the
                                    // exception.
                                    {...(hasDraft && booked === null
                                        ? {
                                              footer: (
                                                  <Pressable
                                                      testID="configurator-start-over"
                                                      role="button"
                                                      accessibilityRole="button"
                                                      onPress={startOver}
                                                      className="min-h-touch justify-center px-2"
                                                  >
                                                      <RNText className="text-sm font-semibold text-content-secondary hover:text-content-primary">
                                                          {t('commerce:configurator.startOver')}
                                                      </RNText>
                                                  </Pressable>
                                              ),
                                          }
                                        : {})}
                                />
                            </View>
                        </View>
                    </View>
                )}
            </QueryStates>
        </View>
    );
}

/** The board's "Your plan is booked": a big tick, the plan and its start, and the two ways on. */
function BookedPanel({
    planName,
    startLabel,
    onSeePlan,
    onBackToPlans,
}: {
    readonly planName: string;
    readonly startLabel: string | null;
    readonly onSeePlan: () => void;
    readonly onBackToPlans: () => void;
}) {
    const { t } = useTranslation();
    return (
        <View
            testID="configurator-booked"
            role="status"
            className="items-center gap-2.5 rounded-[26px] border border-stroke-subtle bg-surface-raised px-6 py-10"
        >
            <View className="h-24 w-24 items-center justify-center rounded-full bg-surface-brand-subtle">
                <Icon name="check" size="lg" className="text-content-on-brand-subtle" />
            </View>
            <RNText
                role="heading"
                aria-level={2}
                className="font-display text-3xl font-bold tracking-display text-content-primary text-center"
            >
                {t('commerce:configurator.booked.title')}
            </RNText>
            <RNText className="text-base text-content-secondary text-center">
                {startLabel === null
                    ? planName
                    : t('commerce:configurator.booked.body', { plan: planName, date: startLabel })}
            </RNText>
            <View className="mt-2.5 flex-row flex-wrap justify-center gap-2.5">
                <Pressable
                    testID="configurator-view-plan"
                    role="button"
                    accessibilityRole="button"
                    onPress={onSeePlan}
                    className="h-[52px] justify-center rounded-2xl border border-stroke px-[18px] hover:bg-surface-sunken"
                >
                    <RNText className="text-sm font-semibold text-content-primary">
                        {t('commerce:configurator.booked.seePlan')}
                    </RNText>
                </Pressable>
                <Pressable
                    testID="configurator-back-to-plans"
                    role="button"
                    accessibilityRole="button"
                    onPress={onBackToPlans}
                    className="h-[52px] justify-center rounded-2xl bg-surface-brand px-5 hover:bg-surface-canopy"
                >
                    <RNText className="text-base font-bold text-content-on-brand">
                        {t('commerce:configurator.booked.backToPlans')}
                    </RNText>
                </Pressable>
            </View>
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

    /*
     * Shop · Plan setup, pin 7: one amber card under "Something still needs an answer", each thing
     * on its own white row with a dot — amber for a question not answered yet, red for what the
     * server refused. The refusal's account steps are the same tiles as everywhere else.
     */
    return (
        <View
            testID="configurator-issues"
            role="alert"
            className="mb-1 mt-3.5 rounded-[18px] bg-warning-subtle px-3 pb-1.5 pt-3"
        >
            <View className="flex-row items-center gap-2 px-0.5 pb-1.5">
                <Icon name="alert" size="md" className="text-warning-on-subtle" />
                <RNText className="shrink text-sm font-bold text-warning-on-subtle text-start">
                    {failure === null
                        ? t('commerce:configurator.issuesTitle')
                        : t('commerce:configurator.createFailedTitle')}
                </RNText>
            </View>
            {failure === null ? null : (
                <View testID="configurator-create-error" className="flex-col">
                    {reasons.length === 0 ? <IssueRow tone="danger" text={failure} /> : null}
                    {otherReasons.map((entry) => (
                        <IssueRow
                            key={entry.reason}
                            testID={`configurator-create-reason-${entry.reason}`}
                            tone="danger"
                            text={t(
                                [
                                    `errors:subscriptionRefusal.${entry.reason}`,
                                    `errors:orderRefusal.${entry.reason}`,
                                ],
                                { defaultValue: entry.reason },
                            )}
                        />
                    ))}
                    {setupSteps.length === 0 ? null : (
                        <View className="mb-1.5">
                            <AccountSetupSteps
                                steps={setupSteps}
                                returnTo={returnTo}
                                testID="configurator-refusal-step"
                            />
                        </View>
                    )}
                </View>
            )}
            {issues.map((key) => (
                <IssueRow
                    key={key}
                    testID={`configurator-issue-${key.split('.').pop() ?? key}`}
                    tone="warning"
                    text={t(key)}
                />
            ))}
        </View>
    );
}

/** One thing still in the way: a white row, a dot for how serious, and the sentence. */
function IssueRow({
    text,
    tone,
    testID,
}: {
    readonly text: string;
    readonly tone: 'warning' | 'danger';
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className="mb-1.5 min-h-[44px] flex-row items-center gap-2.5 rounded-xl bg-surface-raised px-2.5 py-2"
        >
            <View
                className={cx(
                    'h-2 w-2 rounded-full',
                    tone === 'danger' ? 'bg-danger-strong' : 'bg-warning-strong',
                )}
            />
            <RNText className="min-w-0 shrink text-sm font-semibold leading-[17px] text-content-primary text-start">
                {text}
            </RNText>
        </View>
    );
}
