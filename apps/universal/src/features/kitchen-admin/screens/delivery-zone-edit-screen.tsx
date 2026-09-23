import type { DeliveryZoneAdmin, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    FormGrid,
    FormSection,
    Dialog,
    ErrorState,
    Select,
    Skeleton,
    Stack,
    TagRow,
    Text,
    TextInputField,
    useFormSteps,
    useToast,
} from '@healthy360/design-system';
import type { TabItem } from '@healthy360/design-system';
import { CURRENCY_CODES, DeliveryZoneId } from '@healthy360/domain-types';
import type { CurrencyCode, ServiceAreaId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    priceListsFromPages,
    useAdminZoneQuery,
    useAdminZonesQuery,
    useArchiveZoneMutation,
    useCreateZoneMutation,
    usePriceListsQuery,
    useServiceAreasQuery,
    useSetDeliveryWindowsMutation,
    useSetZoneAreasMutation,
    useUpdateZoneMutation,
    zonesFromPages,
} from '../../../data/kitchen-admin-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { BilingualField } from '../bilingual-field.tsx';
import {
    emptyWindow,
    moneyInputState,
    moneyInputValue,
    windowDraft,
    windowErrors,
    windowRequest,
    zoneAreaIds,
} from '../delivery-model.ts';
import type { DeliveryWindowDraft } from '../delivery-model.ts';
import { DeliveryWindowRows, ServiceAreaPicker } from '../delivery-row-editors.tsx';
import { TabStepNavigation } from '../editor-steps.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { displayName, minorAmountToInput, statusKey, statusTone } from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/delivery-zones/{zone}` — one delivery zone: where it reaches, what it charges, and when.
 *
 * ## Three writes, three save controls
 *
 * `updateZone`, `setZoneAreas` and `setDeliveryWindows` are three separate lock-versioned methods,
 * so each section saves itself — the same shape the plan editor's four sections take, for the same
 * reason: folding them into one button would mean chaining three writes and inventing an answer to
 * "the second one failed, is the first still applied?".
 *
 * ## `null` and `0` are kept apart at every step
 *
 * A delivery fee has three states and the form shows all three. Empty is **not recorded**; `0` is
 * **free**, decided; anything else is an amount. The caption under each field says which one is
 * currently held, because two of the three look identical on a consumer surface and only this screen
 * can tell them apart. `moneyInputState` in `../delivery-model.ts` is that rule, pure and asserted
 * directly.
 *
 * ## The currency is chosen once and then stated
 *
 * `CreateDeliveryZoneRequest.currency` is required and `UpdateDeliveryZoneRequest` has no currency
 * field at all, so a zone's currency is immutable after creation — the editor offers a picker on the
 * create form and a fact afterwards, rather than a control that would silently do nothing. The
 * default is derived from the currencies this kitchen already trades in (its zones first, then its
 * price lists) because nothing on the session or the contract publishes an organisational currency
 * (`data/kitchen-admin-hooks.ts`, gap 17).
 *
 * ## Branches are shown and not edited
 *
 * `DeliveryZoneAdmin.branchIds` is a list of identifiers and this contract publishes no branch
 * listing, so a picker here would have to invent its own vocabulary — and a picker missing an option
 * would drop a branch from the zone on the next save, silently, because `branchIds` is replaced
 * wholesale. The branches are therefore a read-only fact, named from the session where it can, and
 * the update request never carries the field.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    /** Major-unit strings. Empty means `null` — see the note on the screen. */
    readonly deliveryFee: string;
    readonly minimumOrder: string;
    readonly estimatedMinutes: number | null;
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    deliveryFee: '',
    minimumOrder: '',
    estimatedMinutes: null,
};

function detailsFrom(zone: DeliveryZoneAdmin): DetailsDraft {
    return {
        name: zone.name,
        deliveryFee:
            zone.deliveryFeeMinor === null
                ? ''
                : minorAmountToInput(zone.deliveryFeeMinor, zone.currency),
        minimumOrder:
            zone.minimumOrderMinor === null
                ? ''
                : minorAmountToInput(zone.minimumOrderMinor, zone.currency),
        estimatedMinutes: zone.estimatedMinutes,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface DeliveryZoneEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly zone: string | undefined;
}

const ZONE_STEPS = ['zone', 'areas', 'windows'] as const;
type ZoneStep = (typeof ZONE_STEPS)[number];

export function DeliveryZoneEditScreen({ zone }: DeliveryZoneEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-zone-editor"
        >
            <DeliveryZoneEditor zone={zone} />
        </Gate>
    );
}

/**
 * The country the organisation in context operates in, from the session rather than a request.
 *
 * The area picker must offer that country's gazetteer and no other: the platform table spans every
 * market — the committed rows are Lebanese, the demo tenant's Emirati — and `setZoneAreas` refuses
 * an area outside the organisation's own country. `me()` already carries the organisation on every
 * membership, so naming the country costs nothing, exactly as the branch editor names its branch.
 *
 * `null` when no membership answers the context, which the surrounding organisation gate makes
 * unreachable here; the picker then reads nothing rather than reading every country.
 */
function useOrganisationCountry(): string | null {
    const access = useAccessState();
    const { me } = useSession();
    const membershipId = access.organisation?.membershipId;

    return useMemo(() => {
        if (membershipId === undefined) return null;
        const membership = me?.memberships.find((candidate) => candidate.id === membershipId);
        return membership?.organisation.countryCode ?? null;
    }, [me, membershipId]);
}

/**
 * The zone's branches, named from the membership in context. An identifier the session cannot name
 * is kept and shown as itself: dropping it would under-state who serves the zone.
 */
function useZoneBranches(
    branchIds: readonly string[] | undefined,
): readonly { readonly id: string; readonly name: string }[] {
    const access = useAccessState();
    const { me } = useSession();
    const membershipId = access.organisation?.membershipId;

    return useMemo(() => {
        const known = me?.memberships.find((candidate) => candidate.id === membershipId)?.branches;
        return (branchIds ?? []).map((id) => ({
            id,
            name: known?.find((branch) => String(branch.id) === id)?.name ?? id,
        }));
    }, [branchIds, me, membershipId]);
}

/** A field this editor states but does not write: a label above a sunken well. */
function ReadOnlyCell({
    label,
    children,
    testID,
}: {
    readonly label: string;
    readonly children: ReactNode;
    readonly testID: string;
}) {
    return (
        <Stack space="xs" testID={testID}>
            <Text variant="label">{label}</Text>
            <View className="min-h-control-sm flex-row flex-wrap items-center gap-tight rounded-sm border border-stroke-subtle bg-surface-sunken px-control-sm py-1">
                {children}
            </View>
        </Stack>
    );
}

function DeliveryZoneEditor({ zone }: DeliveryZoneEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const organisationCountry = useOrganisationCountry();

    const isCreating = zone === undefined || zone === 'new';
    const parsed = isCreating ? null : DeliveryZoneId.safeParse(zone);

    const record = useAdminZoneQuery(parsed);
    const allZones = useAdminZonesQuery({ limit: 100 });
    const priceLists = usePriceListsQuery({ limit: 100 });
    const gazetteer = useServiceAreasQuery(organisationCountry);

    const create = useCreateZoneMutation();
    const update = useUpdateZoneMutation();
    const saveAreasMutation = useSetZoneAreasMutation();
    const saveWindowsMutation = useSetDeliveryWindowsMutation();
    const archive = useArchiveZoneMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const form = useFormSteps(ZONE_STEPS);
    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);
    const [chosenCurrency, setChosenCurrency] = useState<CurrencyCode | null>(null);

    const [areas, setAreas] = useState<readonly ServiceAreaId[]>([]);
    const [areasDirty, setAreasDirty] = useState(false);

    const [windows, setWindows] = useState<readonly DeliveryWindowDraft[]>([]);
    const [windowsDirty, setWindowsDirty] = useState(false);
    const [sectionsKey, setSectionsKey] = useState<string | null>(null);
    const [ordinal, setOrdinal] = useState(1);

    const [showArchive, setShowArchive] = useState(false);
    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);

    const data = record.data;

    const title = isCreating
        ? t('kitchen:zones.createTitle')
        : data === undefined
          ? t('kitchen:zones.editTitle')
          : displayName(data.name, locale).value;
    // The trail's last crumb. A saved zone waits for its record rather than naming a placeholder.
    useKitchenTrailLeaf(isCreating || data !== undefined ? title : null);
    const branchNames = useZoneBranches(data?.branchIds);
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's values still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== sectionsKey && !areasDirty && !windowsDirty) {
        setSectionsKey(serverKey);
        setAreas(zoneAreaIds(data));
        setWindows(data.deliveryWindows.map(windowDraft));
    }

    const takeKey = (prefix: string): string => {
        const key = `${prefix}-${String(ordinal)}`;
        setOrdinal(ordinal + 1);
        return key;
    };

    const markDirty = (mark: () => void) => {
        mark();
        guard.markDirty();
    };

    const settle = (next: {
        readonly details?: boolean;
        readonly areas?: boolean;
        readonly windows?: boolean;
    }) => {
        const after = {
            details: next.details ?? detailsDirty,
            areas: next.areas ?? areasDirty,
            windows: next.windows ?? windowsDirty,
        };
        setDetailsDirty(after.details);
        setAreasDirty(after.areas);
        setWindowsDirty(after.windows);
        if (!after.details && !after.areas && !after.windows) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setAreasDirty(false);
        setWindowsDirty(false);
        setDetailsKey(null);
        setSectionsKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── the currency ────────────────────────────────────────────────────────────────────────── */

    /**
     * What this kitchen already trades in, most-used first.
     *
     * Zones before price lists, because a zone's currency is what a *delivery fee* is quoted in and
     * a kitchen that has priced anything in a currency almost certainly delivers in it too.
     */
    const currenciesInUse = useMemo(() => {
        const counts = new Map<CurrencyCode, number>();
        const bump = (currency: CurrencyCode) => {
            counts.set(currency, (counts.get(currency) ?? 0) + 1);
        };
        for (const row of zonesFromPages(allZones.data?.pages)) bump(row.currency);
        for (const list of priceListsFromPages(priceLists.data?.pages)) bump(list.currency);
        return [...counts.entries()]
            .sort((left, right) => right[1] - left[1])
            .map(([currency]) => currency);
    }, [allZones.data, priceLists.data]);

    const currency: CurrencyCode | null =
        data?.currency ?? chosenCurrency ?? currenciesInUse[0] ?? null;

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const nameMissing = details.name.en.trim() === '';
    const feeState = currency === null ? 'unset' : moneyInputState(details.deliveryFee, currency);
    const minimumState =
        currency === null ? 'unset' : moneyInputState(details.minimumOrder, currency);
    const detailsBlocked =
        nameMissing ||
        currency === null ||
        feeState === 'invalid' ||
        minimumState === 'invalid' ||
        (details.estimatedMinutes !== null && details.estimatedMinutes < 0);

    const windowRowErrors = useMemo(
        () =>
            windowErrors(windows, {
                labelRequired: t('kitchen:windows.labelRequired'),
                weekdaysRequired: t('kitchen:windows.weekdaysRequired'),
                startInvalid: t('kitchen:windows.startInvalid'),
                endInvalid: t('kitchen:windows.endInvalid'),
                endBeforeStart: t('kitchen:windows.endBeforeStart'),
                capacityInvalid: t('kitchen:windows.capacityInvalid'),
            }),
        [windows, t],
    );

    /*
     * Everything that stops the save, in step order, each naming the step and the field that fixes
     * it — the ingredient editor's list on the zone's three steps. A blank waits for Save to be
     * pressed; a value typed wrong is named at once.
     */
    const issues: readonly {
        readonly key: string;
        readonly label: string;
        readonly step: ZoneStep;
        readonly fieldId: string | null;
        readonly required: boolean;
    }[] = [
        ...(nameMissing
            ? [
                  {
                      key: 'name',
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:fields.name'),
                      }),
                      step: 'zone' as const,
                      fieldId: 'kitchen-zone-name-en',
                      required: true,
                  },
              ]
            : []),
        ...(currency === null
            ? [
                  {
                      key: 'currency',
                      label: t('kitchen:zones.currencyLabel'),
                      step: 'zone' as const,
                      fieldId: 'kitchen-zone-currency-select',
                      required: true,
                  },
              ]
            : []),
        ...(feeState === 'invalid'
            ? [
                  {
                      key: 'fee',
                      label: t('kitchen:zones.feeLabel', { currency: currency ?? '' }),
                      step: 'zone' as const,
                      fieldId: 'kitchen-zone-fee',
                      required: false,
                  },
              ]
            : []),
        ...(minimumState === 'invalid'
            ? [
                  {
                      key: 'minimum',
                      label: t('kitchen:zones.minimumLabel', { currency: currency ?? '' }),
                      step: 'zone' as const,
                      fieldId: 'kitchen-zone-minimum',
                      required: false,
                  },
              ]
            : []),
        ...(windowRowErrors.size > 0
            ? [
                  {
                      key: 'windows',
                      label: t('kitchen:zones.sectionWindows'),
                      step: 'windows' as const,
                      fieldId: null,
                      required: false,
                  },
              ]
            : []),
    ];
    const shownIssues = attempted ? issues : issues.filter((entry) => !entry.required);
    const shows = (key: string): boolean => shownIssues.some((entry) => entry.key === key);

    /* ── the step ladder ─────────────────────────────────────────────────────────────────────── */

    /**
     * Whether the later steps can be opened.
     *
     * Details that would be refused on save are not a state to walk away from, so step one has to
     * hold a valid record first. Nothing else gates it: the walk writes at the end, so Areas and
     * Delivery windows are editable on a zone that does not exist yet.
     */
    const stepsUnlocked = !detailsBlocked;

    /**
     * The one save, at the end of the walk: the record, then its areas, then its windows.
     *
     * Three lock-versioned methods still, so this is three writes chained on each other's echo —
     * each one carries the `lockVersion` the previous one returned. **A later write can fail with
     * the earlier ones already applied**, which is the price of one button: the step that failed
     * says so, its section stays dirty, and pressing Save again re-sends only what is still
     * unsaved. Sections that have nothing to write are skipped, so a second press is not a second
     * write of the same rows.
     */
    const finish = () => {
        if (detailsBlocked || currency === null) return;

        void (async () => {
            try {
                let record = data;

                if (isCreating) {
                    record = await create.mutateAsync({
                        name: details.name,
                        currency,
                        deliveryFeeMinor: moneyInputValue(details.deliveryFee, currency),
                        minimumOrderMinor: moneyInputValue(details.minimumOrder, currency),
                        estimatedMinutes: details.estimatedMinutes,
                    });
                    settle({ details: false });
                } else if (record !== undefined && detailsDirty) {
                    record = await update.mutateAsync({
                        zoneId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            name: details.name,
                            deliveryFeeMinor: moneyInputValue(details.deliveryFee, currency),
                            minimumOrderMinor: moneyInputValue(details.minimumOrder, currency),
                            estimatedMinutes: details.estimatedMinutes,
                        },
                    });
                    settle({ details: false });
                }

                if (record === undefined) return;

                if (areasDirty) {
                    record = await saveAreasMutation.mutateAsync({
                        zoneId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            serviceAreaIds: areas,
                        },
                    });
                    setAreas(zoneAreaIds(record));
                    settle({ areas: false });
                }

                if (windowsDirty) {
                    record = await saveWindowsMutation.mutateAsync({
                        zoneId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            windows: windowRequest(windows),
                        },
                    });
                    /*
                     * Rebased on the echo, and this is the save where it matters: a window added
                     * here went up with `id: null` and comes back with the identifier the server
                     * minted. Without the rebase a second press would send the null again and mint
                     * a duplicate — the defect the plan editor's variant save documents.
                     */
                    setWindows(record.deliveryWindows.map(windowDraft));
                    settle({ windows: false });
                }

                toast.show({
                    testID: isCreating ? 'kitchen-zone-created-toast' : 'kitchen-zone-saved-toast',
                    tone: 'success',
                    message: isCreating
                        ? t('kitchen:zones.createdToast', {
                              name: displayName(record.name, locale).value,
                          })
                        : t('kitchen:editor.savedToast'),
                });
                router.push('/kitchen/delivery-zones' as never);
            } catch (error) {
                concurrency.capture(error);
            }
        })();
    };

    const goTo = (step: ZoneStep, fieldId: string | null) => {
        form.goTo(step);
        if (fieldId !== null) focusField(fieldId);
    };

    /*
     * Save the zone is pressable over an incomplete form. The press marks the form attempted and
     * takes the reader to the first thing that stops it; only a clean form reaches `finish`.
     */
    const attemptSave = () => {
        if (!canManage) return;
        setAttempted(true);
        const first = issues[0];
        if (first !== undefined) {
            goTo(first.step, first.fieldId);
            return;
        }
        finish();
    };

    const saving =
        create.isPending ||
        update.isPending ||
        saveAreasMutation.isPending ||
        saveWindowsMutation.isPending;

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-zone-editor-screen">
                <Callout
                    testID="kitchen-zone-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:zones.notFoundTitle')}
                    body={t('kitchen:zones.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-zone-not-found-back"
                            variant="quiet"
                            label={t('kitchen:zones.backToList')}
                            onPress={() => {
                                router.push('/kitchen/delivery-zones' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-zone-editor-loading">
                <Skeleton testID="kitchen-zone-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-zone-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-zone-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-zone-editor-screen">
                <ErrorState
                    testID="kitchen-zone-load-error"
                    failure={loadFailure}
                    title={t('kitchen:zones.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    const areasFailure = toFailure(saveAreasMutation.error);
    const windowsFailure = toFailure(saveWindowsMutation.error);
    const gazetteerFailure = toFailure(gazetteer.error);
    const isRetired = data?.meta.status === 'retired';

    const status = data?.meta.status ?? 'draft';
    const stepIssues = (step: ZoneStep) => {
        const count = shownIssues.filter((entry) => entry.step === step).length;
        return count === 0
            ? undefined
            : {
                  count,
                  tone: 'danger' as const,
                  label: t('kitchen:forms.toFixCount', { count }),
              };
    };

    const stepItems: readonly TabItem<ZoneStep>[] = [
        {
            value: 'zone',
            label: t('kitchen:zones.sectionDetails'),
            issues: stepIssues('zone'),
            testID: 'kitchen-zone-editor-screen-steps-zone',
        },
        {
            value: 'areas',
            label: t('kitchen:zones.sectionAreas'),
            count: areas.length,
            disabled: !stepsUnlocked,
            testID: 'kitchen-zone-editor-screen-steps-areas',
        },
        {
            value: 'windows',
            label: t('kitchen:zones.sectionWindows'),
            count: windows.length,
            disabled: !stepsUnlocked,
            issues: stepIssues('windows'),
            testID: 'kitchen-zone-editor-screen-steps-windows',
        },
    ];

    return (
        <Stack space="md" testID="kitchen-zone-editor-screen">
            <RecordFormOpening<ZoneStep>
                testID="kitchen-zone-editor-screen"
                title={title}
                dirty={guard.isDirty}
                badges={
                    <Badge
                        variant="caps"
                        testID={
                            isRetired
                                ? 'kitchen-zone-archived'
                                : 'kitchen-zone-editor-screen-status'
                        }
                        tone={statusTone(status)}
                        icon={null}
                        label={t(statusKey(status))}
                    />
                }
                actions={
                    <>
                        <Button
                            testID="kitchen-zone-editor-screen-back"
                            variant="secondary"
                            label={t('kitchen:editor.cancel')}
                            onPress={() => {
                                guard.intercept(() => {
                                    router.push('/kitchen/delivery-zones' as never);
                                });
                            }}
                        />
                        {isCreating || !canManage || isRetired ? null : (
                            <Button
                                testID="kitchen-zone-archive"
                                variant="quiet"
                                label={t('kitchen:list.archive')}
                                onPress={() => {
                                    setShowArchive(true);
                                }}
                            />
                        )}
                        {/*
                         * The one Save, on every step rather than only the last: the walk writes at
                         * the end, and the end is wherever the reader stops.
                         */}
                        {canManage ? (
                            <Button
                                testID="kitchen-zone-windows-save"
                                label={t('kitchen:zones.saveZone')}
                                loading={saving}
                                disabled={saving}
                                onPress={attemptSave}
                            />
                        ) : null}
                    </>
                }
                errors={{
                    summary: t(
                        shownIssues.every((entry) => entry.required)
                            ? 'kitchen:forms.requiredCount'
                            : 'kitchen:forms.toFixCount',
                        { count: shownIssues.length },
                    ),
                    items: shownIssues.map((entry) => ({
                        key: entry.key,
                        label: entry.label,
                        onPress: () => {
                            goTo(entry.step, entry.fieldId);
                        },
                    })),
                }}
                steps={{
                    label: t('kitchen:editor.stepsLabel'),
                    value: form.current,
                    onChange: form.goTo,
                    /*
                     * Areas and windows wait for a record that would save: details the server would
                     * refuse are not a state to walk away from. Nothing else gates them — the walk
                     * writes at the end, so both are editable before the zone exists.
                     */
                    items: stepItems,
                }}
            />

            {saveFailure === null ? null : (
                <Callout
                    testID="kitchen-zone-save-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:editor.saveError')}
                    body={saveFailure.message}
                />
            )}

            {/* ── the record ───────────────────────────────────────────────────────────────── */}
            {form.current !== 'zone' ? null : (
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-zone-details"
                    title={t('kitchen:zones.sectionDetails')}
                >
                    {/*
                     * The design's 280px tracks. The name pair takes two of them, so the Arabic
                     * name sits beside the English one rather than under it.
                     */}
                    <FormGrid testID="kitchen-zone-details-grid">
                        <BilingualField
                            span={2}
                            layout="row"
                            testID="kitchen-zone-name"
                            fieldLabel={t('kitchen:fields.name')}
                            value={details.name}
                            requiredEnglish
                            {...(shows('name')
                                ? { englishError: t('kitchen:forms.required') }
                                : {})}
                            onChange={(next) => {
                                markDirty(() => {
                                    setDetails({ ...details, name: next });
                                    setDetailsDirty(true);
                                });
                            }}
                        />

                        {isCreating ? (
                            <Select
                                testID="kitchen-zone-currency-select"
                                id="kitchen-zone-currency-select"
                                label={t('kitchen:zones.currencyLabel')}
                                searchable
                                required
                                {...(shows('currency')
                                    ? { error: t('kitchen:forms.required') }
                                    : {})}
                                value={currency}
                                options={CURRENCY_CODES.map((code) => ({
                                    value: code,
                                    label: code,
                                }))}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setChosenCurrency(next);
                                        setDetailsDirty(true);
                                    });
                                }}
                            />
                        ) : (
                            <ReadOnlyCell
                                testID="kitchen-zone-currency"
                                label={t('kitchen:zones.currencyLabel')}
                            >
                                <Text testID="kitchen-zone-currency-value" variant="caption">
                                    {currency ?? t('kitchen:common.notRecorded')}
                                </Text>
                            </ReadOnlyCell>
                        )}

                        <TextInputField
                            testID="kitchen-zone-estimated"
                            id="kitchen-zone-estimated"
                            label={t('kitchen:zones.estimatedLabel')}
                            size="sm"
                            value={
                                details.estimatedMinutes === null
                                    ? ''
                                    : String(details.estimatedMinutes)
                            }
                            inputMode="numeric"
                            autoCorrect={false}
                            disabled={!canManage}
                            onChangeText={(next) => {
                                // Empty is "not advertised" (null), never zero minutes.
                                const digits = next.replace(/[^0-9]/gu, '');
                                markDirty(() => {
                                    setDetails({
                                        ...details,
                                        estimatedMinutes: digits === '' ? null : Number(digits),
                                    });
                                    setDetailsDirty(true);
                                });
                            }}
                        />

                        <TextInputField
                            testID="kitchen-zone-fee"
                            id="kitchen-zone-fee"
                            label={t('kitchen:zones.feeLabel', {
                                currency: currency ?? t('kitchen:common.notRecorded'),
                            })}
                            size="sm"
                            value={details.deliveryFee}
                            inputMode="decimal"
                            autoCorrect={false}
                            disabled={!canManage}
                            {...(feeState === 'invalid'
                                ? { error: t('kitchen:zones.amountInvalid') }
                                : {})}
                            onChangeText={(next) => {
                                markDirty(() => {
                                    setDetails({ ...details, deliveryFee: next });
                                    setDetailsDirty(true);
                                });
                            }}
                        />
                        <TextInputField
                            testID="kitchen-zone-minimum"
                            id="kitchen-zone-minimum"
                            label={t('kitchen:zones.minimumLabel', {
                                currency: currency ?? t('kitchen:common.notRecorded'),
                            })}
                            size="sm"
                            value={details.minimumOrder}
                            inputMode="decimal"
                            autoCorrect={false}
                            disabled={!canManage}
                            {...(minimumState === 'invalid'
                                ? { error: t('kitchen:zones.amountInvalid') }
                                : {})}
                            onChangeText={(next) => {
                                markDirty(() => {
                                    setDetails({ ...details, minimumOrder: next });
                                    setDetailsDirty(true);
                                });
                            }}
                        />

                        {/*
                         * Named from the session's own branches where it knows them; an identifier
                         * this membership cannot name is shown as itself rather than dropped.
                         */}
                        <ReadOnlyCell
                            testID="kitchen-zone-branches"
                            label={t('kitchen:zones.branchesLabel')}
                        >
                            {branchNames.length === 0 ? (
                                <Text
                                    testID="kitchen-zone-branch-count"
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {t('kitchen:zones.noBranches')}
                                </Text>
                            ) : (
                                <TagRow
                                    testID="kitchen-zone-branch-tags"
                                    items={branchNames.map((branch) => ({
                                        key: branch.id,
                                        label: branch.name,
                                    }))}
                                />
                            )}
                        </ReadOnlyCell>
                    </FormGrid>
                </FormSection>
            )}

            {/* ── areas ────────────────────────────────────────────────────────────────────── */}
            {form.current !== 'areas' ? null : (
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-zone-areas"
                    title={t('kitchen:zones.sectionAreas')}
                >
                    <Stack space="md">
                        {gazetteer.isPending ? (
                            <Skeleton testID="kitchen-zone-areas-loading" heightClassName="h-24" />
                        ) : gazetteerFailure !== null ? (
                            <ErrorState
                                testID="kitchen-zone-areas-error"
                                failure={gazetteerFailure}
                                onRetry={() => {
                                    void gazetteer.refetch();
                                }}
                                retrying={gazetteer.isFetching}
                            />
                        ) : (
                            <ServiceAreaPicker
                                testID="kitchen-zone-area-picker"
                                gazetteer={gazetteer.data?.areas ?? []}
                                selected={areas}
                                canManage={canManage}
                                locale={locale}
                                truncated={gazetteer.data?.truncated ?? false}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setAreas(next);
                                        setAreasDirty(true);
                                    });
                                }}
                            />
                        )}

                        {areasFailure === null ? null : (
                            <Callout
                                testID="kitchen-zone-areas-save-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:areas.saveError')}
                                body={areasFailure.message}
                            />
                        )}
                    </Stack>
                </FormSection>
            )}

            {/* ── delivery windows ─────────────────────────────────────────────────────────── */}
            {form.current !== 'windows' ? null : (
                <FormSection
                    first
                    variant="underlined"
                    testID="kitchen-zone-windows"
                    title={t('kitchen:zones.sectionWindows')}
                >
                    <Stack space="md">
                        <DeliveryWindowRows
                            testID="kitchen-zone-window-rows"
                            rows={windows}
                            errors={windowRowErrors}
                            canManage={canManage}
                            onChange={(next) => {
                                markDirty(() => {
                                    setWindows(next);
                                    setWindowsDirty(true);
                                });
                            }}
                            onAdd={() => {
                                markDirty(() => {
                                    setWindows([...windows, emptyWindow(takeKey('window'))]);
                                    setWindowsDirty(true);
                                });
                            }}
                        />

                        {windowsFailure === null ? null : (
                            <Callout
                                testID="kitchen-zone-windows-save-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:windows.saveError')}
                                body={windowsFailure.message}
                            />
                        )}
                    </Stack>
                </FormSection>
            )}

            <TabStepNavigation<ZoneStep>
                testID="kitchen-zone-editor-screen-steps-nav"
                items={stepItems}
                value={form.current}
                onChange={form.goTo}
            />

            {/* ── archive ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-zone-archive-dialog"
                open={showArchive}
                onClose={() => {
                    setShowArchive(false);
                }}
                title={t('kitchen:zones.archiveTitle')}
                description={t('kitchen:zones.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-zone-archive-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowArchive(false);
                            }}
                        />
                        <Button
                            testID="kitchen-zone-archive-confirm"
                            variant="danger"
                            label={t('kitchen:zones.archiveConfirm')}
                            loading={archive.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                archive.mutate(
                                    {
                                        zoneId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowArchive(false);
                                            toast.show({
                                                testID: 'kitchen-zone-archived-toast',
                                                tone: 'success',
                                                message: t('kitchen:zones.archivedToast', {
                                                    name: displayName(data.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            setShowArchive(false);
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {/*
                 * What archiving actually costs, counted from the record rather than described in
                 * the abstract. A zone is only projected onto a branch while it is published, so
                 * retiring one takes it off every branch that serves it — which is the consequence
                 * a person needs before they agree, not afterwards.
                 */}
                <Stack space="xs">
                    <Text testID="kitchen-zone-archive-consequence">
                        {t('kitchen:zones.archiveConsequence')}
                    </Text>
                    {data === undefined ? null : (
                        <Stack space="none">
                            <Text testID="kitchen-zone-archive-branches" variant="caption">
                                {t('kitchen:zones.archiveBranchCount', {
                                    count: data.branchIds.length,
                                })}
                            </Text>
                            <Text testID="kitchen-zone-archive-areas" variant="caption">
                                {t('kitchen:zones.archiveAreaCount', {
                                    count: data.areas.length,
                                })}
                            </Text>
                            <Text testID="kitchen-zone-archive-windows" variant="caption">
                                {t('kitchen:zones.archiveWindowCount', {
                                    count: data.deliveryWindows.length,
                                })}
                            </Text>
                        </Stack>
                    )}
                </Stack>
            </Dialog>

            <EditorGuardDialogs
                testID="kitchen-zone-editor-screen"
                guard={guard}
                concurrency={concurrency}
            />
        </Stack>
    );
}
