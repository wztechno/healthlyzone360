import {
    Badge,
    Button,
    Callout,
    Cascade,
    EmptyState,
    ErrorState,
    FormSection,
    FormSkeleton,
    Text,
    useToast,
} from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useBranchOperatingQuery,
    useSetBranchOperatingMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { weekdayKey } from '../../marketplace/format.ts';
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
import { SideRailLayout } from '../side-rail-layout.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

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
 * The least the week keeps beside the summary before the summary drops under it — the week's 796px
 * of tracks plus the card's padding, so Copy is never the column that pays for the aside.
 */
const WEEK_MIN_WIDTH = 830;

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
    const { t } = useTranslation();
    const toast = useToast();
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
    const [announcement, setAnnouncement] = useState('');

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
                    toast.show({
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

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
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
    const everyDayClosed = summary.openDays === 0;
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
                dirty={guard.isDirty}
                badges={
                    <Badge
                        variant="label"
                        testID="kitchen-branch-hours-screen-chip"
                        tone="neutral"
                        icon={null}
                        label={t('kitchen:branchHours.chip')}
                    />
                }
                actions={
                    canManage ? (
                        <Button
                            testID="kitchen-branch-hours-screen-save"
                            label={t('kitchen:branchHours.save')}
                            loading={save.isPending}
                            disabled={!dirty || dayIssues.size > 0 || save.isPending}
                            onPress={saveWeek}
                        />
                    ) : undefined
                }
            />

            {saveFailure === null ? null : (
                <Callout
                    testID="kitchen-branch-hours-save-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:branchHours.saveError')}
                    body={saveFailure.message}
                />
            )}

            {everyDayClosed ? (
                <Callout
                    testID="kitchen-branch-hours-all-closed"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:branchHours.allClosedTitle')}
                    body={t('kitchen:branchHours.allClosedBody')}
                />
            ) : null}

            {/* The week is the row's filler beside the fixed summary. */}
            <SideRailLayout
                bounded
                sticky
                testID="kitchen-branch-hours-editor"
                mainBasis={WEEK_MIN_WIDTH}
                main={
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-branch-hours-week"
                        title={t('kitchen:branchHours.weekTitle')}
                        aside={
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:branchHours.cutOffHint')}
                            </Text>
                        }
                    >
                        <OperatingWeekRows
                            testID="kitchen-branch-hours-rows"
                            rows={days}
                            issues={dayIssues}
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
                }
                /*
                 * The week in a few facts and in words, day by day — what the stat cards and each
                 * row's sentence used to say, read top to bottom in one place.
                 */
                rail={
                    <RecordSummaryAside
                        testID="kitchen-branch-hours-summary"
                        title={t('kitchen:branchHours.summaryTitle')}
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
                }
            />

            <EditorGuardDialogs
                guard={guard}
                concurrency={concurrency}
                testID="kitchen-branch-hours-screen"
            />
        </Cascade>
    );
}
