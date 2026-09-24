import {
    Button,
    Callout,
    EmptyState,
    ErrorState,
    FormSkeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

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
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
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
            <FormSkeleton
                testID="kitchen-branch-hours-loading"
                partTestID="kitchen-branch-hours"
                sections={2}
                tabs={0}
            />
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
            title={t('kitchen:branchHours.title')}
            titleChip={{ label: t('kitchen:branchHours.chip'), tone: 'neutral' }}
            summary={
                <CatalogueStatCards
                    testID="kitchen-branch-hours-cards"
                    cards={[
                        {
                            key: 'trading',
                            label: t('kitchen:branchHours.cardTrading'),
                            value: String(summary.openDays),
                            unit: t('kitchen:branchHours.cardTradingUnit', {
                                count: summary.openDays,
                            }),
                            caption: branch?.name ?? '',
                            mark: 'calendar',
                            tone: summary.openDays === 0 ? 'warning' : 'default',
                        },
                        {
                            key: 'closed',
                            label: t('kitchen:branchHours.closedLabel'),
                            value: String(7 - summary.openDays),
                            unit: t('kitchen:branchHours.cardDayUnit', {
                                count: 7 - summary.openDays,
                            }),
                            caption: t('kitchen:branchHours.cardClosedCaption'),
                            mark: 'ban',
                        },
                        {
                            key: 'cut-off',
                            label: t('kitchen:branchHours.cardCutOff'),
                            value: String(summary.withCutOff),
                            unit: t('kitchen:branchHours.cardDayUnit', {
                                count: summary.withCutOff,
                            }),
                            caption: t('kitchen:branchHours.cardCutOffCaption'),
                            mark: 'clock',
                        },
                    ]}
                />
            }
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveWeek}
            saveLabel={t('kitchen:branchHours.save')}
            saving={save.isPending}
            saveDisabled={!canManage || !dirty || dayErrors.size > 0}
            /*
             * No Back and no Save in the header. The trail already leads back to the workspace, and
             * the week's one Save sits under the week, beside the rule a reader most often breaks —
             * two Saves for one form was one too many. The unsaved guard still stands on every exit.
             */
            hideSave
            hideBack
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
            {/*
             * The week, with no heading over it: the page title already says what it is, and the
             * rows say the rest.
             */}
            <View testID="kitchen-branch-hours-week" className="z-auto flex-col">
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

                {/* The page's only Save, under the week, beside the rule a reader most often breaks. */}
                {canManage ? (
                    <View className="flex-row flex-wrap items-center gap-tight px-tight pt-snug">
                        <Button
                            testID="kitchen-branch-hours-save-bottom"
                            label={t('kitchen:branchHours.save')}
                            loading={save.isPending}
                            disabled={!dirty || dayErrors.size > 0 || save.isPending}
                            onPress={saveWeek}
                        />
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:branchHours.cutOffAfterCloses')}
                        </Text>
                    </View>
                ) : null}
            </View>
        </EditorFrame>
    );
}
