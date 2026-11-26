import type { KitchenServiceSettings } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    Dialog,
    EmptyState,
    ErrorState,
    FailureToast,
    FormSection,
    FormSkeleton,
    Icon,
    InfoTip,
    REQUIRED_MARK,
    Text,
    TextInputField,
    useTablePort,
    useToast,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useBranchOperatingQuery,
    useSetBranchOperatingMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    useBranchClosuresQuery,
    useCreateBranchMutation,
} from '../../../data/kitchen-ops-hooks.ts';
import {
    useKitchenServiceSettingsQuery,
    useSaveKitchenServiceSettingsMutation,
} from '../../../data/staff-alerts-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { weekdayKey } from '../../marketplace/format.ts';
import { BranchClosuresSection } from '../branch-closures-section.tsx';
import {
    copyDayToOpenDays,
    operatingDraftsFrom,
    operatingIssues,
    operatingRequest,
    summariseOperating,
} from '../delivery-model.ts';
import type { OperatingDayDraft } from '../delivery-model.ts';
import { OperatingWeekRows } from '../delivery-row-editors.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { RecordSummaryAside } from '../record-summary-aside.tsx';
import { serverFieldErrors } from '../server-field-errors.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

import { useLocalSearchParams } from 'expo-router';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useFinishDetour } from '../finish-detour.ts';
/**
 * `/kitchen/branch-operating` — when this branch trades, and when it stops taking today's orders.
 *
 * Laid out as the other record forms are: the opening with the week's one Save, the week in a card,
 * and beside it a sticky summary of the week — the facts and each day in words.
 *
 * ```
 * Opening hours and cut-offs  ONE RECORD PER BRANCH  ⚠ Unsaved               [ Save the week ]
 * ┌ TRADING WEEK ─────────────────────────────────────────────────┐  ┌ THIS WEEK ───────────────┐
 * │ Day        Trading    Opens      Closes     Last same-day order │  │ Branch       Main Kitchen │
 * │ Monday     [Open ▾]   [08:00 ◷]  [23:00 ◷]  [20:30 ◷]   Copy…  │  │ Closed              1 day │
 * │ Sunday ⦸   [Closed ▾] [--:-- ◷]  [--:-- ◷]  [--:-- ◷]          │  │ Order cut-off      0 days │
 * └───────────────────────────────────────────────────────────────┘  │ Trading  6 days a week    │
 *                                                                    │ Day by day                │
 *                                                                    │ Monday        08:00–23:00 │
 *                                                                    └───────────────────────────┘
 * ```
 *
 * The gap the architectural review exposed (plan §K1.7): the v1 schema had kitchen branches with no
 * opening hours and no order cut-offs at all, and a cut-off is exactly the kind of rule that must
 * not be inferred from silence. This is the screen that makes all seven days answerable.
 *
 * ## The subject is the branch already in context, and that is not a shortcut
 *
 * `getBranchOperating` takes a branch identifier and `KitchenAdminRepository` publishes **no branch
 * listing** (`data/kitchen-admin-hooks.ts`, gap 16), so a picker here would have to invent its
 * vocabulary from somewhere the contract does not offer. It does not need one: the whole `kitchen`
 * area is `requiresBranch: true` in the route registry (`@healthy360/permissions`), so a person who
 * reaches this screen has already chosen a branch and the gate has already redirected anybody who
 * has not. Editing another branch's hours is a *context switch*, which the shell owns, and this
 * screen does not duplicate the picker.
 *
 * ## One identifier, two brands, and the crossing is made here on purpose
 *
 * The session's active context carries a `BranchId` — an organisation branch. `getBranchOperating`
 * takes a `KitchenBranchId`. They are separate brands in `@healthy360/domain-types` because an
 * organisation branch and a kitchen branch are separate records in the plan's schema, and in this
 * world they resolve to the same identity for a kitchen organisation's branch. Rather than
 * scattering that assumption, it is made exactly once, in {@link kitchenBranchOf}, where the
 * reconciliation pass can find it: when the wire says which of the two a kitchen branch really is,
 * this function changes and nothing else does.
 *
 * ## The time zone is not edited here
 *
 * `SetBranchOperatingRequest.timeZone` exists, and nothing in this contract publishes the list of
 * IANA zones a picker would need. A free-text field for `Asia/Dubai` is a field that accepts
 * `Asia/Duabi`, and a mistyped zone shifts every cut-off on this page by hours without saying so.
 * Changing it belongs with whoever owns the branch record.
 *
 * ## The service timings sit here, and save on their own
 *
 * How long a kitchen needs before a window, and how long an order may wait before somebody is told,
 * sit beside the hours they count against. They are one record per organisation rather than one per
 * branch, so they carry their own Save and their own unsaved guard, and they are drawn only for
 * someone who may edit them, because their read refuses a reader who may only look at this page.
 */

/**
 * The kitchen branch the session's active branch corresponds to.
 *
 * The single place the two brands are crossed. See the note on the screen.
 */
function kitchenBranchOf(branchId: string): KitchenBranchId {
    return KitchenBranchId.unsafe(branchId);
}

const EM_DASH = '—';

/**
 * The summary's fixed track, and the least the week beside it keeps before the summary drops under
 * it — the week's 796px of tracks plus the card's padding, so Copy is never the column that pays
 * for the aside.
 */
const ASIDE_WIDTH = 300;
const FORM_MIN_WIDTH = 830;
const COLUMN_GAP = 16;

type ServiceTimingKey = keyof KitchenServiceSettings;

/** The four timings: each field's copy, its name on the wire, and its place in the form. */
const SERVICE_TIMINGS = [
    { key: 'orderLeadMinutes', copy: 'lead', server: 'order_lead_minutes' },
    { key: 'alarmAfterMinutes', copy: 'alarm', server: 'alarm_after_minutes' },
    { key: 'managerAlertAfterMinutes', copy: 'manager', server: 'manager_alert_after_minutes' },
    { key: 'ownerAlertAfterMinutes', copy: 'owner', server: 'owner_alert_after_minutes' },
] as const satisfies readonly {
    readonly key: ServiceTimingKey;
    readonly copy: string;
    readonly server: string;
}[];

export function BranchOperatingScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-branch-hours"
        >
            <BranchOperatingEditor />
        </Gate>
    );
}

function BranchOperatingEditor() {
    // Opened from Setup or an alert: saving the week is the job, and it goes back there.
    const rawReturn = useLocalSearchParams().returnTo;
    const back = useReturnTo(
        Array.isArray(rawReturn) ? rawReturn[0] : rawReturn,
        '/kitchen/branch-operating',
    );
    const finishDetour = useFinishDetour(back);
    const { t } = useTranslation();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    const access = useAccessState();
    const { me } = useSession();

    const branchId = access.branch === undefined ? null : kitchenBranchOf(String(access.branch.id));

    /**
     * The branch's own name, from the session rather than from a request.
     *
     * `me()` already carries every branch of every membership, with its name, code and time zone —
     * so naming the record costs nothing, and the alternative (reading the *consumer* marketplace
     * kitchen to find a branch name) would have this workspace depend on a published kitchen page.
     */
    const branch = useMemo(() => {
        if (access.branch === undefined) return null;
        for (const membership of me?.memberships ?? []) {
            const found = membership.branches.find(
                (candidate) => String(candidate.id) === String(access.branch?.id),
            );
            if (found !== undefined) return found;
        }
        return null;
    }, [me, access.branch]);

    const record = useBranchOperatingQuery(branchId);
    const save = useSetBranchOperatingMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [days, setDays] = useState<readonly OperatingDayDraft[]>([]);
    const [daysKey, setDaysKey] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const [timingsDirty, setTimingsDirty] = useState(false);
    const [announcement, setAnnouncement] = useState('');
    const [addingBranch, setAddingBranch] = useState(false);
    /*
     * Read from the node rather than `onLayout`, which on the web delivered one early width and
     * nothing after — see the sale screen. The port re-reads on resize and when the page panel settles.
     */
    const port = useTablePort();
    const bodyWidth = port.width;

    const title = t('kitchen:branchHours.title');
    useKitchenTrailLeaf(title);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.branchId)}:${String(data.meta.lockVersion)}`;

    if (data !== undefined && serverKey !== daysKey && !dirty) {
        setDaysKey(serverKey);
        setDays(operatingDraftsFrom(data));
    }

    const markDirty = (mark: () => void) => {
        mark();
        setDirty(true);
        guard.markDirty();
    };

    const reload = useCallback(() => {
        setDirty(false);
        setDaysKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const dayIssues = useMemo(
        () =>
            operatingIssues(days, {
                opensInvalid: t('kitchen:branchHours.opensInvalid'),
                closesInvalid: t('kitchen:branchHours.closesInvalid'),
                closesBeforeOpens: t('kitchen:branchHours.closesBeforeOpens'),
                cutOffInvalid: t('kitchen:branchHours.cutOffInvalid'),
                cutOffAfterCloses: t('kitchen:branchHours.cutOffAfterCloses'),
            }),
        [days, t],
    );

    const summary = summariseOperating(days);

    /*
     * The next closure that has not ended yet, for the summary: the date someone checking this page
     * most often wants. Read from the closures card's own query, so no second request.
     */
    const formatter = useFormatter();
    const closures = useBranchClosuresQuery();
    const today = new Date().toISOString().slice(0, 10);
    const nextClosure =
        (closures.data ?? [])
            .filter((closure) => closure.closedTo >= today)
            .sort((a, b) => a.closedFrom.localeCompare(b.closedFrom))[0] ?? null;

    const saveWeek = () => {
        if (data === undefined || branchId === null || dayIssues.size > 0) return;
        save.mutate(
            {
                branchId,
                request: {
                    lockVersion: data.meta.lockVersion,
                    days: operatingRequest(days),
                },
            },
            {
                onSuccess: (saved) => {
                    setDays(operatingDraftsFrom(saved));
                    setDirty(false);
                    guard.markClean();
                    finishDetour({
                        testID: 'kitchen-branch-hours-saved-toast',
                        tone: 'success',
                        message: t('kitchen:branchHours.savedToast', {
                            count: summariseOperating(operatingDraftsFrom(saved)).openDays,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── refusal, loading and failure ────────────────────────────────────────────────────────── */

    if (branchId === null) {
        return (
            <Cascade space="md" testID="kitchen-branch-hours-screen">
                <EmptyState
                    testID="kitchen-branch-hours-no-branch"
                    title={t('kitchen:branchHours.noBranchTitle')}
                    body={t('kitchen:branchHours.noBranchBody')}
                />
            </Cascade>
        );
    }

    if (record.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-branch-hours-loading"
                partTestID="kitchen-branch-hours"
                heading={false}
                sections={1}
                tabs={0}
            />
        );
    }

    // Only a first load. A background refetch that fails keeps the week it has, and whatever is
    // typed in this page's forms with it.
    const loadFailure = toFailure(record.error);
    if (loadFailure !== null && data === undefined) {
        return (
            <Cascade space="md" testID="kitchen-branch-hours-screen">
                <ErrorState
                    testID="kitchen-branch-hours-load-error"
                    failure={loadFailure}
                    title={t('kitchen:branchHours.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Cascade>
        );
    }

    const saveFailure = toFailure(save.error);
    // What the server refused, put on the day's field it named (BUG-06). No issue tray here, so
    // the callout carries whatever no field could.
    const server = serverFieldErrors(saveFailure, {
        'days.*.weekday': {
            label: t('kitchen:branchHours.columnTrading'),
            fieldId: 'kitchen-branch-hours-rows',
        },
        'days.*.opens_at': {
            label: t('kitchen:branchHours.opensLabel'),
            fieldId: 'kitchen-branch-hours-rows',
        },
        'days.*.closes_at': {
            label: t('kitchen:branchHours.closesLabel'),
            fieldId: 'kitchen-branch-hours-rows',
        },
        'days.*.order_cut_off_at': {
            label: t('kitchen:branchHours.cutOffLabel'),
            fieldId: 'kitchen-branch-hours-rows',
        },
    });
    // `days.N` is the day's place in the request, which `operatingRequest` sends in weekday order.
    const requestOrder = operatingRequest(days).map((day) => day.weekday);
    const dayError = (weekday: number, field: string): string | undefined => {
        const index = requestOrder.indexOf(weekday);
        return index === -1 ? undefined : server.errorFor(`days.${String(index)}.${field}`);
    };
    const everyDayClosed = summary.openDays === 0;
    const sideBySide = bodyWidth >= ASIDE_WIDTH + FORM_MIN_WIDTH + COLUMN_GAP;
    const dayCount = (count: number) =>
        `${String(count)} ${t('kitchen:branchHours.cardDayUnit', { count })}`;

    return (
        <Cascade space="md" testID="kitchen-branch-hours-screen">
            {/*
             * The opening the record forms share: the title, what kind of record it is, the unsaved
             * marker and the week's one Save. No Back — the trail already leads to the workspace,
             * and the unsaved guard stands on every exit.
             */}
            <RecordFormOpening
                testID="kitchen-branch-hours-screen"
                title={title}
                dirty={guard.isDirty || timingsDirty}
                save={
                    canManage
                        ? {
                              testID: 'kitchen-branch-hours-screen-save',
                              label: t('kitchen:branchHours.save'),
                              loading: save.isPending,
                              disabled: !dirty || dayIssues.size > 0 || save.isPending,
                              onPress: saveWeek,
                          }
                        : undefined
                }
                badges={
                    <Badge
                        variant="label"
                        testID="kitchen-branch-hours-screen-chip"
                        tone="neutral"
                        label={t('kitchen:branchHours.chip')}
                    />
                }
                actions={
                    canManage ? (
                        <>
                            <Button
                                testID="kitchen-branch-new"
                                variant="secondary"
                                size="sm"
                                label={t('kitchen:branchClosures.newBranch')}
                                onPress={() => {
                                    setAddingBranch(true);
                                }}
                            />
                        </>
                    ) : undefined
                }
            />

            <FailureToast
                failure={saveFailure}
                testID="kitchen-branch-hours-save-error"
                title={t('kitchen:branchHours.saveError')}
                body={server.unplaced ?? saveFailure?.message}
            />

            {everyDayClosed ? (
                <Callout
                    testID="kitchen-branch-hours-all-closed"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:branchHours.allClosedTitle')}
                    body={t('kitchen:branchHours.allClosedBody')}
                />
            ) : null}

            <View
                ref={Platform.OS === 'web' ? port.ref : undefined}
                onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                className={
                    sideBySide ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                }
            >
                {/* The week is the row's filler beside the fixed summary. */}
                <View className="z-auto min-w-0 flex-1 flex-col gap-base">
                    <FormSection
                        first
                        variant="panel"
                        testID="kitchen-branch-hours-week"
                        title={t('kitchen:branchHours.weekTitle')}
                        description={t('kitchen:branchHours.cutOffHint')}
                        aside={
                            <Badge
                                testID="kitchen-branch-hours-week-scope"
                                tone="neutral"
                                label={t('kitchen:branchHours.scopeBranch')}
                            />
                        }
                    >
                        <OperatingWeekRows
                            testID="kitchen-branch-hours-rows"
                            rows={days}
                            issues={dayIssues}
                            serverError={dayError}
                            canManage={canManage}
                            announcement={announcement}
                            onChange={(next) => {
                                markDirty(() => {
                                    setDays(next);
                                });
                            }}
                            onCopyToOpenDays={(weekday) => {
                                markDirty(() => {
                                    const next = copyDayToOpenDays(days, weekday);
                                    setDays(next);
                                    setAnnouncement(
                                        t('kitchen:branchHours.copiedAnnouncement', {
                                            day: t(weekdayKey(weekday)),
                                            count: summariseOperating(next).openDays - 1,
                                        }),
                                    );
                                });
                            }}
                        />
                    </FormSection>

                    <BranchClosuresSection canManage={canManage} />

                    {canManage ? <ServiceTimingsSection onDirtyChange={setTimingsDirty} /> : null}
                </View>

                {/*
                 * The week in a few facts and in words, day by day — what the stat cards and each
                 * row's sentence used to say, read top to bottom in one place.
                 */}
                <RecordSummaryAside
                    testID="kitchen-branch-hours-summary"
                    variant="panel"
                    title={t('kitchen:branchHours.summaryTitle')}
                    width={sideBySide ? ASIDE_WIDTH : null}
                    rows={[
                        /*
                         * Named only when the session knows the name: an organisation-wide
                         * membership lists no branches, and a row that always read "—" for an
                         * owner would be a fact the page does not have.
                         */
                        ...(branch === null
                            ? []
                            : [
                                  {
                                      key: 'branch',
                                      label: t('kitchen:branchHours.summaryBranch'),
                                      value: branch.name,
                                  },
                              ]),
                        // The zone every time on the page is read in — stated, because it is not
                        // edited here (see the note on the screen).
                        {
                            key: 'time-zone',
                            label: t('kitchen:branchHours.summaryTimeZone'),
                            value: data?.timeZone ?? EM_DASH,
                        },
                        {
                            key: 'closed',
                            label: t('kitchen:branchHours.closedLabel'),
                            value: dayCount(summary.closedDays),
                        },
                        {
                            key: 'cut-off',
                            label: t('kitchen:branchHours.cardCutOff'),
                            value: dayCount(summary.withCutOff),
                        },
                        {
                            key: 'next-closure',
                            label: t('kitchen:branchHours.summaryNextClosure'),
                            value:
                                nextClosure === null
                                    ? t('kitchen:branchHours.summaryNoClosure')
                                    : formatter.formatDate(`${nextClosure.closedFrom}T00:00:00`, {
                                          dateStyle: 'medium',
                                      }),
                        },
                    ]}
                    total={{
                        label: t('kitchen:branchHours.cardTrading'),
                        value: `${String(summary.openDays)} ${t(
                            'kitchen:branchHours.cardTradingUnit',
                            { count: summary.openDays },
                        )}`,
                    }}
                    list={{
                        title: t('kitchen:branchHours.summaryDays'),
                        // Never drawn: the week always has its seven days.
                        empty: '',
                        testID: 'kitchen-branch-hours-summary-days',
                        emptyTestID: 'kitchen-branch-hours-summary-days-empty',
                        items: days.map((day) => ({
                            key: String(day.weekday),
                            testID: `kitchen-branch-hours-summary-day-${String(day.weekday)}`,
                            name: t(weekdayKey(day.weekday)),
                            value: day.isClosed
                                ? t('kitchen:branchHours.closedLabel')
                                : t('kitchen:branchHours.dayHours', {
                                      opens: day.opensAt === '' ? EM_DASH : day.opensAt,
                                      closes: day.closesAt === '' ? EM_DASH : day.closesAt,
                                  }),
                        })),
                    }}
                />
            </View>

            <EditorGuardDialogs
                guard={guard}
                concurrency={concurrency}
                testID="kitchen-branch-hours-screen"
            />

            <NewBranchDialog
                open={addingBranch}
                onClose={() => {
                    setAddingBranch(false);
                }}
            />
        </Cascade>
    );
}

/** Opens another branch. It joins the branch picker at the next sign-in or context refresh. */
function NewBranchDialog({
    open,
    onClose,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const create = useCreateBranchMutation();
    const [name, setName] = useState('');
    const [city, setCity] = useState('');
    const failure = toFailure(create.error);

    return (
        <Dialog
            look="card"
            testID="kitchen-branch-new-dialog"
            open={open}
            onClose={onClose}
            title={t('kitchen:branchClosures.newBranch')}
            actions={
                <>
                    <Button
                        testID="kitchen-branch-new-cancel"
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="kitchen-branch-new-save"
                        label={t('kitchen:branchClosures.newBranchSave')}
                        loading={create.isPending}
                        disabled={name.trim() === '' || create.isPending}
                        onPress={() => {
                            create.mutate(
                                {
                                    name: name.trim(),
                                    city: city.trim() === '' ? null : city.trim(),
                                },
                                {
                                    onSuccess: () => {
                                        setName('');
                                        setCity('');
                                        onClose();
                                        toast.show({
                                            testID: 'kitchen-branch-new-toast',
                                            tone: 'success',
                                            message: t('kitchen:branchClosures.newBranchToast'),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            <FailureToast
                failure={failure}
                testID="kitchen-branch-new-error"
                title={t('kitchen:branchClosures.newBranchError')}
                body={failure?.message}
            />
            <TextInputField
                testID="kitchen-branch-new-name"
                id="kitchen-branch-new-name"
                label={t('kitchen:branchClosures.newBranchName')}
                size="sm"
                required
                value={name}
                onChangeText={setName}
            />
            <TextInputField
                testID="kitchen-branch-new-city"
                id="kitchen-branch-new-city"
                label={t('kitchen:branchClosures.newBranchCity')}
                size="sm"
                value={city}
                onChangeText={setCity}
            />
        </Dialog>
    );
}

/** The kitchen's service timings. See the note on the screen for why they save on their own. */
function ServiceTimingsSection({
    onDirtyChange,
}: {
    /** The page's one unsaved marker covers this form too. */
    readonly onDirtyChange: (dirty: boolean) => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const settings = useKitchenServiceSettingsQuery();
    const save = useSaveKitchenServiceSettingsMutation();
    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });
    /** Only what has been typed, as typed: a field may be empty on its way to a new number. */
    const [edits, setEdits] = useState<Partial<Record<ServiceTimingKey, string>>>({});
    const dirty = Object.keys(edits).length > 0;
    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    const loadFailure = toFailure(settings.error);
    if (loadFailure !== null && settings.data === undefined) {
        return (
            <ErrorState
                testID="kitchen-service-timings-load-error"
                failure={loadFailure}
                title={t('kitchen:serviceTimings.loadErrorTitle')}
                onRetry={() => {
                    void settings.refetch();
                }}
                retrying={settings.isFetching}
            />
        );
    }

    const stored = settings.data;
    if (stored === undefined) {
        return (
            <FormSkeleton
                testID="kitchen-service-timings-loading"
                partTestID="kitchen-service-timings"
                heading={false}
                sections={1}
                tabs={0}
            />
        );
    }

    const shown = (key: ServiceTimingKey) => edits[key] ?? String(stored[key]);
    /** Typed in whole dollars, kept in cents. */
    const refundLimit =
        edits.refundApprovalAboveMinor ?? String(stored.refundApprovalAboveMinor / 100);
    /** Left empty, the kitchen has no limit. */
    const windowLimit = edits.ordersPerWindow ?? String(stored.ordersPerWindow ?? '');
    /** Whole percentages. Left empty, the check is off. */
    const priceLimit =
        edits.priceApprovalAbovePercent ?? String(stored.priceApprovalAbovePercent ?? '');
    const marginTarget =
        edits.dishMarginTargetPercent ?? String(stored.dishMarginTargetPercent ?? '');
    const complete = SERVICE_TIMINGS.every(({ key }) => shown(key) !== '') && refundLimit !== '';

    const saveFailure = toFailure(save.error);
    const server = serverFieldErrors(
        saveFailure,
        Object.fromEntries(
            [
                ...SERVICE_TIMINGS,
                { copy: 'refund', server: 'refund_approval_above_minor' },
                { copy: 'capacity', server: 'orders_per_window' },
                { copy: 'priceLimit', server: 'price_approval_above_percent' },
                { copy: 'marginTarget', server: 'dish_margin_target_percent' },
            ].map(({ copy, server: field }) => [
                field,
                {
                    label: t(`kitchen:serviceTimings.${copy}Label`),
                    fieldId: `kitchen-service-timings-${copy}`,
                },
            ]),
        ),
    );

    const saveTimings = () => {
        save.mutate(
            {
                orderLeadMinutes: Number(shown('orderLeadMinutes')),
                alarmAfterMinutes: Number(shown('alarmAfterMinutes')),
                managerAlertAfterMinutes: Number(shown('managerAlertAfterMinutes')),
                ownerAlertAfterMinutes: Number(shown('ownerAlertAfterMinutes')),
                refundApprovalAboveMinor: Number(refundLimit) * 100,
                ordersPerWindow: windowLimit === '' ? null : Number(windowLimit),
                priceApprovalAbovePercent: priceLimit === '' ? null : Number(priceLimit),
                dishMarginTargetPercent: marginTarget === '' ? null : Number(marginTarget),
            },
            {
                onSuccess: () => {
                    setEdits({});
                    guard.markClean();
                    toast.show({
                        testID: 'kitchen-service-timings-saved-toast',
                        tone: 'success',
                        message: t('kitchen:serviceTimings.savedToast'),
                    });
                },
            },
        );
    };

    /** Sets one field's draft, digits only, and marks the form unsaved. */
    const edit = (key: ServiceTimingKey) => (next: string) => {
        setEdits({ ...edits, [key]: next.replace(/[^0-9]/gu, '') });
        guard.markDirty();
    };

    /**
     * One setting as a row: its name (with the tip) at the start, a narrow box with its unit at the
     * end. The box carries the same name, hidden, so it is still labelled for a screen reader.
     */
    const timingRow = ({
        copy,
        field,
        value,
        onChange,
        unit,
        required = false,
        placeholder,
    }: {
        readonly copy: string;
        readonly field: string;
        readonly value: string;
        readonly onChange: (next: string) => void;
        readonly unit: string;
        readonly required?: boolean;
        readonly placeholder?: string | undefined;
    }) => {
        const label = t(`kitchen:serviceTimings.${copy}Label`);
        const hint = t(`kitchen:serviceTimings.${copy}Hint`);
        return (
            <View
                key={copy}
                className="min-h-10 min-w-[300px] flex-1 basis-[420px] flex-row items-center justify-between gap-3"
            >
                <View className="min-w-0 flex-1 flex-row items-center gap-1">
                    <Text variant="strong" numberOfLines={2}>
                        {label}
                        {required ? <Text tone="danger">{` ${REQUIRED_MARK}`}</Text> : null}
                    </Text>
                    <InfoTip
                        label={label}
                        text={hint}
                        testID={`kitchen-service-timings-${copy}-info`}
                    />
                </View>
                <View className="w-[120px]">
                    <TextInputField
                        testID={`kitchen-service-timings-${copy}`}
                        id={`kitchen-service-timings-${copy}`}
                        label={label}
                        labelHidden
                        hint={hint}
                        size="sm"
                        inputMode="numeric"
                        autoCorrect={false}
                        required={required}
                        placeholder={placeholder}
                        trailing={
                            <Text variant="caption" tone="secondary">
                                {unit}
                            </Text>
                        }
                        value={value}
                        {...server.flag(field)}
                        onChangeText={onChange}
                    />
                </View>
            </View>
        );
    };

    const minutes = t('kitchen:serviceTimings.unit');
    /** The three waits, in the order an order meets them. */
    const steps = [
        {
            key: 'alarmAfterMinutes',
            copy: 'alarm',
            server: 'alarm_after_minutes',
            dot: 'bg-success',
        },
        {
            key: 'managerAlertAfterMinutes',
            copy: 'manager',
            server: 'manager_alert_after_minutes',
            dot: 'bg-warning-border',
        },
        {
            key: 'ownerAlertAfterMinutes',
            copy: 'owner',
            server: 'owner_alert_after_minutes',
            dot: 'bg-danger',
        },
    ] as const;

    return (
        <>
            <FormSection
                variant="panel"
                testID="kitchen-service-timings"
                title={t('kitchen:serviceTimings.title')}
                description={t('kitchen:serviceTimings.description')}
                aside={
                    <Badge
                        testID="kitchen-service-timings-scope"
                        tone="success"
                        label={t('kitchen:serviceTimings.scopeKitchen')}
                    />
                }
                actions={
                    <Button
                        testID="kitchen-service-timings-save"
                        size="sm"
                        label={t('kitchen:serviceTimings.save')}
                        loading={save.isPending}
                        disabled={!dirty || !complete || save.isPending}
                        onPress={saveTimings}
                    />
                }
            >
                <FailureToast
                    failure={saveFailure}
                    testID="kitchen-service-timings-save-error"
                    title={t('kitchen:serviceTimings.saveError')}
                    body={server.unplaced ?? saveFailure?.message}
                />
                <View className="gap-3" testID="kitchen-service-timings-grid">
                    <TimingGroup
                        testID="kitchen-service-timings-group-orders"
                        icon="calendar"
                        title={t('kitchen:serviceTimings.groupOrders')}
                    >
                        <View className="flex-row flex-wrap gap-x-7 gap-y-1.5">
                            {timingRow({
                                copy: 'lead',
                                field: 'order_lead_minutes',
                                value: shown('orderLeadMinutes'),
                                onChange: edit('orderLeadMinutes'),
                                unit: minutes,
                                required: true,
                            })}
                            {timingRow({
                                copy: 'capacity',
                                field: 'orders_per_window',
                                value: windowLimit,
                                onChange: edit('ordersPerWindow'),
                                unit: t('kitchen:serviceTimings.capacityUnit'),
                                placeholder: t('kitchen:serviceTimings.noLimit'),
                            })}
                        </View>
                    </TimingGroup>

                    {/*
                     * The three waits as a chain, because their order is the rule: the display
                     * alarms first, then the managers are told, then the owner. Each step must come
                     * later than the one before it.
                     */}
                    <TimingGroup
                        testID="kitchen-service-timings-group-waits"
                        icon="bell"
                        title={t('kitchen:serviceTimings.groupWaits')}
                        hint={t('kitchen:serviceTimings.groupWaitsHint')}
                    >
                        <View className="flex-row flex-wrap items-center gap-2">
                            {steps.map((step, index) => {
                                const label = t(`kitchen:serviceTimings.${step.copy}Label`);
                                return (
                                    <View
                                        key={step.key}
                                        className="min-w-[180px] flex-1 flex-row items-center gap-2"
                                    >
                                        {index === 0 ? null : (
                                            <Icon
                                                name="chevronEnd"
                                                size="sm"
                                                className="text-content-secondary"
                                            />
                                        )}
                                        <View className="min-w-0 flex-1 gap-1.5 rounded-xl bg-surface-raised px-3 py-2.5">
                                            <View className="flex-row items-center gap-1.5">
                                                <View
                                                    aria-hidden
                                                    className={`h-2 w-2 rounded-full ${step.dot}`}
                                                />
                                                <Text variant="strong" numberOfLines={1}>
                                                    {label}
                                                    <Text tone="danger">{` ${REQUIRED_MARK}`}</Text>
                                                </Text>
                                            </View>
                                            <TextInputField
                                                testID={`kitchen-service-timings-${step.copy}`}
                                                id={`kitchen-service-timings-${step.copy}`}
                                                label={label}
                                                labelHidden
                                                hint={t(`kitchen:serviceTimings.${step.copy}Hint`)}
                                                size="sm"
                                                inputMode="numeric"
                                                autoCorrect={false}
                                                required
                                                trailing={
                                                    <Text variant="caption" tone="secondary">
                                                        {minutes}
                                                    </Text>
                                                }
                                                value={shown(step.key)}
                                                {...server.flag(step.server)}
                                                onChangeText={edit(step.key)}
                                            />
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    </TimingGroup>

                    <TimingGroup
                        testID="kitchen-service-timings-group-owner"
                        icon="shield"
                        title={t('kitchen:serviceTimings.groupOwner')}
                    >
                        <View className="flex-row flex-wrap gap-x-7 gap-y-1.5">
                            {timingRow({
                                copy: 'refund',
                                field: 'refund_approval_above_minor',
                                value: refundLimit,
                                onChange: edit('refundApprovalAboveMinor'),
                                unit: t('kitchen:serviceTimings.refundUnit'),
                                required: true,
                            })}
                            {timingRow({
                                copy: 'priceLimit',
                                field: 'price_approval_above_percent',
                                value: priceLimit,
                                onChange: edit('priceApprovalAbovePercent'),
                                unit: t('kitchen:serviceTimings.percentUnit'),
                                placeholder: t('kitchen:serviceTimings.off'),
                            })}
                            {timingRow({
                                copy: 'marginTarget',
                                field: 'dish_margin_target_percent',
                                value: marginTarget,
                                onChange: edit('dishMarginTargetPercent'),
                                unit: t('kitchen:serviceTimings.percentUnit'),
                                placeholder: t('kitchen:serviceTimings.off'),
                            })}
                        </View>
                    </TimingGroup>
                </View>
            </FormSection>
            <EditorGuardDialogs guard={guard} testID="kitchen-service-timings" />
        </>
    );
}

/**
 * One group of service timings: a sunken tray with a small mark and an uppercase name, then its
 * settings (Opening hours option A, Commercial canvas 2026-11-23). The groups say what the eight
 * numbers are for — taking orders, chasing an order that waits, and what needs the owner — so a row
 * of eight equal boxes with wrapped labels is no longer the page.
 */
function TimingGroup({
    title,
    icon,
    hint,
    testID,
    children,
}: {
    readonly title: string;
    readonly icon: IconName;
    readonly hint?: string | undefined;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    return (
        <View testID={testID} className="z-auto gap-2.5 rounded-2xl bg-surface-sunken p-3.5">
            <View className="flex-row items-center gap-2">
                <View className="h-7 w-7 items-center justify-center rounded-lg bg-surface-raised">
                    <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
                </View>
                <Text
                    variant="caption"
                    tone="secondary"
                    accessibilityRole="header"
                    className="font-bold uppercase tracking-wider"
                >
                    {title}
                </Text>
                {hint === undefined ? null : (
                    <InfoTip label={title} text={hint} testID={`${testID}-info`} />
                )}
            </View>
            {children}
        </View>
    );
}
