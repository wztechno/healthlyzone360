import type { DeliveryZoneAdmin, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    Heading,
    Inline,
    NumberStepper,
    Select,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { CURRENCY_CODES, DeliveryZoneId } from '@healthy360/domain-types';
import type { CurrencyCode, ServiceAreaId } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    summariseWindows,
    windowDraft,
    windowErrors,
    windowRequest,
    zoneAreaIds,
} from '../delivery-model.ts';
import type { DeliveryWindowDraft } from '../delivery-model.ts';
import { DeliveryWindowRows, ServiceAreaPicker } from '../delivery-row-editors.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { displayName, minorAmountToInput } from '../format.ts';
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
 * wholesale. The count is therefore a read-only fact and the update request never carries the field.
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

    const data = record.data;
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

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveDetails = () => {
        if (detailsBlocked || currency === null) return;

        if (isCreating) {
            create.mutate(
                {
                    name: details.name,
                    currency,
                    deliveryFeeMinor: moneyInputValue(details.deliveryFee, currency),
                    minimumOrderMinor: moneyInputValue(details.minimumOrder, currency),
                    estimatedMinutes: details.estimatedMinutes,
                },
                {
                    onSuccess: (created) => {
                        settle({ details: false, areas: false, windows: false });
                        toast.show({
                            testID: 'kitchen-zone-created-toast',
                            tone: 'success',
                            message: t('kitchen:zones.createdToast', {
                                name: displayName(created.name, locale).value,
                            }),
                        });
                        router.replace(`/kitchen/delivery-zones/${String(created.id)}` as never);
                    },
                },
            );
            return;
        }

        if (data === undefined) return;
        update.mutate(
            {
                zoneId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    deliveryFeeMinor: moneyInputValue(details.deliveryFee, currency),
                    minimumOrderMinor: moneyInputValue(details.minimumOrder, currency),
                    estimatedMinutes: details.estimatedMinutes,
                },
            },
            {
                onSuccess: () => {
                    settle({ details: false });
                    toast.show({
                        testID: 'kitchen-zone-saved-toast',
                        tone: 'success',
                        message: t('kitchen:editor.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const saveAreas = () => {
        if (data === undefined) return;
        saveAreasMutation.mutate(
            {
                zoneId: data.id,
                request: { lockVersion: data.meta.lockVersion, serviceAreaIds: areas },
            },
            {
                onSuccess: (saved) => {
                    // Rebased on the server's echo rather than left as the local draft: the
                    // whole-record rebuild above is skipped while any *other* section is dirty, so
                    // each save has to rebase its own rows.
                    setAreas(zoneAreaIds(saved));
                    settle({ areas: false });
                    toast.show({
                        testID: 'kitchen-zone-areas-saved-toast',
                        tone: 'success',
                        message: t('kitchen:areas.savedToast', { count: saved.areas.length }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const saveWindows = () => {
        if (data === undefined || windowRowErrors.size > 0) return;
        saveWindowsMutation.mutate(
            {
                zoneId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    windows: windowRequest(windows),
                },
            },
            {
                onSuccess: (saved) => {
                    /*
                     * Rebased on the echo, and this is the save where it matters: a window added
                     * here went up with `id: null` and comes back with the identifier the server
                     * minted. Without the rebase a second save would send the null again and mint a
                     * duplicate — the same defect the plan editor's variant save documents.
                     */
                    setWindows(saved.deliveryWindows.map(windowDraft));
                    settle({ windows: false });
                    toast.show({
                        testID: 'kitchen-zone-windows-saved-toast',
                        tone: 'success',
                        message: t('kitchen:windows.savedToast', {
                            count: saved.deliveryWindows.length,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

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
    // The live summary of what is on screen, not of what the server holds: the badges are how a
    // person checks their own work before saving.
    const draftCoverage = summariseWindows(windows);

    return (
        <EditorFrame
            testID="kitchen-zone-editor-screen"
            title={
                isCreating
                    ? t('kitchen:zones.createTitle')
                    : data === undefined
                      ? t('kitchen:zones.editTitle')
                      : displayName(data.name, locale).value
            }
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={create.isPending || update.isPending}
            saveDisabled={!canManage || detailsBlocked}
            backLabel={t('kitchen:zones.backToList')}
            onBack={() => {
                router.push('/kitchen/delivery-zones' as never);
            }}
            primaryAction={
                isCreating || !canManage || isRetired ? null : (
                    <Button
                        testID="kitchen-zone-archive"
                        variant="secondary"
                        label={t('kitchen:list.archive')}
                        onPress={() => {
                            setShowArchive(true);
                        }}
                    />
                )
            }
            banner={
                <Stack space="sm">
                    {isRetired ? (
                        <Callout
                            testID="kitchen-zone-archived"
                            role="note"
                            tone="info"
                            title={t('kitchen:zones.archivedTitle')}
                            body={t('kitchen:zones.archivedBody')}
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-zone-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── the record ───────────────────────────────────────────────────────────────── */}
            <Card testID="kitchen-zone-details" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:zones.sectionDetails')}</Heading>

                    <BilingualField
                        testID="kitchen-zone-name"
                        fieldLabel={t('kitchen:fields.name')}
                        value={details.name}
                        requiredEnglish
                        {...(nameMissing ? { englishError: t('kitchen:zones.nameRequired') } : {})}
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
                            hint={t('kitchen:zones.currencyCreateHint')}
                            searchable
                            required
                            value={currency}
                            options={CURRENCY_CODES.map((code) => ({ value: code, label: code }))}
                            onChange={(next) => {
                                markDirty(() => {
                                    setChosenCurrency(next);
                                    setDetailsDirty(true);
                                });
                            }}
                        />
                    ) : (
                        <Stack space="none" testID="kitchen-zone-currency">
                            <Text variant="label">{t('kitchen:zones.currencyLabel')}</Text>
                            <Text testID="kitchen-zone-currency-value" variant="bodyStrong">
                                {currency ?? t('kitchen:common.notRecorded')}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:zones.currencyFixedHint')}
                            </Text>
                        </Stack>
                    )}

                    <Stack space="xs">
                        <TextInputField
                            testID="kitchen-zone-fee"
                            id="kitchen-zone-fee"
                            label={t('kitchen:zones.feeLabel', {
                                currency: currency ?? t('kitchen:common.notRecorded'),
                            })}
                            hint={t('kitchen:zones.feeHint')}
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
                        <Text testID="kitchen-zone-fee-state" variant="caption" tone="secondary">
                            {feeState === 'unset'
                                ? t('kitchen:zones.feeStateUnset')
                                : feeState === 'zero'
                                  ? t('kitchen:zones.feeStateZero')
                                  : feeState === 'invalid'
                                    ? t('kitchen:zones.amountInvalid')
                                    : t('kitchen:zones.feeStateAmount')}
                        </Text>
                    </Stack>

                    <Stack space="xs">
                        <TextInputField
                            testID="kitchen-zone-minimum"
                            id="kitchen-zone-minimum"
                            label={t('kitchen:zones.minimumLabel', {
                                currency: currency ?? t('kitchen:common.notRecorded'),
                            })}
                            hint={t('kitchen:zones.minimumHint')}
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
                        <Text
                            testID="kitchen-zone-minimum-state"
                            variant="caption"
                            tone="secondary"
                        >
                            {minimumState === 'unset'
                                ? t('kitchen:zones.minimumStateUnset')
                                : minimumState === 'zero'
                                  ? t('kitchen:zones.minimumStateZero')
                                  : minimumState === 'invalid'
                                    ? t('kitchen:zones.amountInvalid')
                                    : t('kitchen:zones.minimumStateAmount')}
                        </Text>
                    </Stack>

                    <NumberStepper
                        testID="kitchen-zone-estimated"
                        id="kitchen-zone-estimated"
                        label={t('kitchen:zones.estimatedLabel')}
                        hint={t('kitchen:zones.estimatedHint')}
                        unit={t('kitchen:zones.estimatedUnit')}
                        min={0}
                        max={1440}
                        step={5}
                        disabled={!canManage}
                        value={details.estimatedMinutes}
                        onChange={(next) => {
                            markDirty(() => {
                                setDetails({ ...details, estimatedMinutes: next });
                                setDetailsDirty(true);
                            });
                        }}
                    />

                    {details.estimatedMinutes === null ? (
                        <Text
                            testID="kitchen-zone-estimated-state"
                            variant="caption"
                            tone="secondary"
                        >
                            {t('kitchen:zones.estimatedNone')}
                        </Text>
                    ) : null}

                    {data === undefined ? null : (
                        <Stack space="none" testID="kitchen-zone-branches">
                            <Text variant="label">{t('kitchen:zones.branchesLabel')}</Text>
                            <Text testID="kitchen-zone-branch-count">
                                {t('kitchen:zones.branchCount', { count: data.branchIds.length })}
                            </Text>
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:zones.branchesReadOnly')}
                            </Text>
                        </Stack>
                    )}
                </Stack>
            </Card>

            {/* ── areas ────────────────────────────────────────────────────────────────────── */}
            {isCreating ? (
                <Card testID="kitchen-zone-areas-unavailable" padding="md">
                    <Stack space="sm">
                        <Heading level={2}>{t('kitchen:zones.sectionAreas')}</Heading>
                        <Text tone="secondary">{t('kitchen:zones.createFirst')}</Text>
                    </Stack>
                </Card>
            ) : (
                <Card testID="kitchen-zone-areas" padding="md">
                    <Stack space="md">
                        <Inline space="sm" align="center" justify="between" wrap>
                            <Heading level={2}>{t('kitchen:zones.sectionAreas')}</Heading>
                            <Badge
                                testID="kitchen-zone-areas-count"
                                tone="neutral"
                                icon="dot"
                                label={t('kitchen:zones.areaCount', { count: areas.length })}
                            />
                        </Inline>

                        <Text tone="secondary">{t('kitchen:zones.areasIntro')}</Text>

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

                        {canManage ? (
                            <Inline space="sm" wrap justify="end">
                                <Button
                                    testID="kitchen-zone-areas-save"
                                    label={t('kitchen:areas.save')}
                                    loading={saveAreasMutation.isPending}
                                    disabled={!areasDirty || saveAreasMutation.isPending}
                                    onPress={saveAreas}
                                />
                            </Inline>
                        ) : null}
                    </Stack>
                </Card>
            )}

            {/* ── delivery windows ─────────────────────────────────────────────────────────── */}
            {isCreating ? (
                <Card testID="kitchen-zone-windows-unavailable" padding="md">
                    <Stack space="sm">
                        <Heading level={2}>{t('kitchen:zones.sectionWindows')}</Heading>
                        <Text tone="secondary">{t('kitchen:zones.createFirst')}</Text>
                    </Stack>
                </Card>
            ) : (
                <Card testID="kitchen-zone-windows" padding="md">
                    <Stack space="md">
                        <Inline space="sm" align="center" justify="between" wrap>
                            <Heading level={2}>{t('kitchen:zones.sectionWindows')}</Heading>
                            <Inline space="xs" wrap>
                                <Badge
                                    testID="kitchen-zone-windows-count"
                                    tone="neutral"
                                    icon="dot"
                                    label={t('kitchen:windows.count', {
                                        count: draftCoverage.total,
                                    })}
                                />
                                <Badge
                                    testID="kitchen-zone-windows-coverage"
                                    tone={draftCoverage.weekdays.length === 0 ? 'warning' : 'info'}
                                    {...(draftCoverage.weekdays.length === 0
                                        ? { icon: 'warning' as const }
                                        : {})}
                                    label={t('kitchen:windows.coveredDayCount', {
                                        count: draftCoverage.weekdays.length,
                                    })}
                                />
                            </Inline>
                        </Inline>

                        <Text tone="secondary">{t('kitchen:zones.windowsIntro')}</Text>

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

                        {canManage ? (
                            <Inline space="sm" wrap justify="end">
                                <Button
                                    testID="kitchen-zone-windows-save"
                                    label={t('kitchen:windows.save')}
                                    loading={saveWindowsMutation.isPending}
                                    disabled={
                                        !windowsDirty ||
                                        windowRowErrors.size > 0 ||
                                        saveWindowsMutation.isPending
                                    }
                                    onPress={saveWindows}
                                />
                            </Inline>
                        ) : null}
                    </Stack>
                </Card>
            )}

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
        </EditorFrame>
    );
}
