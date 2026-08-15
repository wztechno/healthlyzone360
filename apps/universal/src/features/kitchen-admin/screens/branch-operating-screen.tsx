import {
    Badge,
    Callout,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
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
    operatingErrors,
    operatingRequest,
    summariseOperating,
} from '../delivery-model.ts';
import type { OperatingDayDraft } from '../delivery-model.ts';
import { OperatingWeekRows } from '../delivery-row-editors.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/branch-operating` — when this branch trades, and when it stops taking today's orders.
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
 * screen says so rather than duplicating the picker.
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
 * ## The time zone is stated and not edited
 *
 * `SetBranchOperatingRequest.timeZone` exists, and nothing in this contract publishes the list of
 * IANA zones a picker would need. A free-text field for `Asia/Dubai` is a field that accepts
 * `Asia/Duabi`, and a mistyped zone shifts every cut-off on this page by hours without saying so.
 * The zone is therefore shown as the fact the times are read in; changing it belongs with whoever
 * owns the branch record.
 */

/**
 * The kitchen branch the session's active branch corresponds to.
 *
 * The single place the two brands are crossed. See the note on the screen.
 */
function kitchenBranchOf(branchId: string): KitchenBranchId {
    return KitchenBranchId.unsafe(branchId);
}

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
    const router = useRouter();
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

    const dayErrors = useMemo(
        () =>
            operatingErrors(days, {
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
        if (data === undefined || branchId === null || dayErrors.size > 0) return;
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
            <Stack space="lg" testID="kitchen-branch-hours-screen">
                <EmptyState
                    testID="kitchen-branch-hours-no-branch"
                    title={t('kitchen:branchHours.noBranchTitle')}
                    body={t('kitchen:branchHours.noBranchBody')}
                />
            </Stack>
        );
    }

    if (record.isPending) {
        return (
            <Stack space="md" testID="kitchen-branch-hours-loading">
                <Skeleton testID="kitchen-branch-hours-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-branch-hours-skeleton-2" heightClassName="h-64" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-branch-hours-screen">
                <ErrorState
                    testID="kitchen-branch-hours-load-error"
                    failure={loadFailure}
                    title={t('kitchen:branchHours.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(save.error);
    const everyDayClosed = summary.openDays === 0;

    return (
        <EditorFrame
            testID="kitchen-branch-hours-screen"
            title={
                branch === null
                    ? t('kitchen:branchHours.title')
                    : t('kitchen:branchHours.titleFor', { branch: branch.name })
            }
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveWeek}
            saveLabel={t('kitchen:branchHours.save')}
            saving={save.isPending}
            saveDisabled={!canManage || !dirty || dayErrors.size > 0}
            backLabel={t('kitchen:branchHours.backToHub')}
            onBack={() => {
                router.push('/kitchen' as never);
            }}
            banner={
                <Stack space="sm">
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
                </Stack>
            }
        >
            <Card testID="kitchen-branch-hours-context" padding="md">
                <Stack space="sm">
                    <Heading level={2}>{t('kitchen:branchHours.sectionContext')}</Heading>

                    <Inline space="sm" wrap align="center">
                        <Badge
                            testID="kitchen-branch-hours-branch"
                            tone="neutral"
                            icon="branch"
                            label={
                                branch === null
                                    ? t('kitchen:branchHours.branchUnknown')
                                    : t('kitchen:branchHours.branchBadge', {
                                          branch: branch.name,
                                          code: branch.code,
                                      })
                            }
                        />
                        <Badge
                            testID="kitchen-branch-hours-timezone"
                            tone="info"
                            label={t('kitchen:branchHours.timeZoneBadge', {
                                zone: data?.timeZone ?? t('kitchen:common.notRecorded'),
                            })}
                        />
                        <Badge
                            testID="kitchen-branch-hours-open-days"
                            tone={summary.openDays === 0 ? 'warning' : 'success'}
                            {...(summary.openDays === 0 ? { icon: 'warning' as const } : {})}
                            label={t('kitchen:branchHours.openDayCount', {
                                count: summary.openDays,
                            })}
                        />
                        <Badge
                            testID="kitchen-branch-hours-cut-offs"
                            tone="neutral"
                            label={t('kitchen:branchHours.cutOffDayCount', {
                                count: summary.withCutOff,
                            })}
                        />
                    </Inline>

                    <Text tone="secondary" testID="kitchen-branch-hours-context-note">
                        {t('kitchen:branchHours.contextNote')}
                    </Text>
                </Stack>
            </Card>

            <Card testID="kitchen-branch-hours-week" padding="md">
                <Stack space="md">
                    <Heading level={2}>{t('kitchen:branchHours.sectionWeek')}</Heading>
                    <Text tone="secondary">{t('kitchen:branchHours.weekIntro')}</Text>

                    <OperatingWeekRows
                        testID="kitchen-branch-hours-rows"
                        rows={days}
                        errors={dayErrors}
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
                </Stack>
            </Card>
        </EditorFrame>
    );
}
