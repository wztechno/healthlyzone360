import type { PreparationMode, SendVdMessageRequest } from '@healthy360/api-client/contracts';
import {
    Breadcrumbs,
    Card,
    EmptyState,
    Heading,
    PageTransition,
    Stack,
} from '@healthy360/design-system';
import { VdSessionId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../../data/hooks.ts';
import { todayIso, weekStartFor } from '../../../data/marketplace-hooks.ts';
import {
    useAcceptVdProposalMutation,
    useGenerateVdDraftMutation,
    useOverrideVdProposalMutation,
    useRequestVdReviewMutation,
    useSendVdMessageMutation,
    useVdSessionQuery,
} from '../../../data/vd-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { Composer } from '../composer.tsx';
import { CollectedPanel, MessageList } from '../message-list.tsx';
import { OverrideDialog } from '../override-dialog.tsx';
import { SessionTimeline } from '../session-timeline.tsx';
import { StateAnnouncer } from '../state-announcer.tsx';
import { VdStatePanel } from '../state-panels.tsx';
import type { StatePanelActions } from '../state-panels.tsx';

/**
 * `/customer/virtual-dietitian/{session}` — the whole journey, all twelve states.
 *
 * ## Why one screen rather than twelve routes
 *
 * The state is a property of the session, not of the URL. A person who reloads mid-interview must
 * land where they were, and a state that changed while they were reading must change under them
 * rather than requiring a navigation. So the route addresses the *session* and the panel switch
 * addresses the state — which also means a deep link to any of the twelve fixture sessions renders
 * that state from a cold start, and the tests exercise exactly what a person would reach.
 *
 * ## The disclaimer is rendered here, once, outside the switch
 *
 * `MedicalDisclaimer` is mandatory on every Virtual Dietitian state (plan §5). Rendering it in each
 * of the twelve panels would make its presence twelve separate promises, one of which would
 * eventually be broken; rendering it around the switch makes omission structurally impossible. The
 * per-state test asserts it anyway, because "structurally impossible" is a claim worth checking.
 *
 * ## Every action is a real repository call
 *
 * Send, accept, override, generate and request-review all go through
 * `VirtualDietitianRepository` and write to the world. The single exception is "open in the
 * planner", which belongs to a route another wave owns; it discloses the destination and the
 * contract rather than leading nowhere (plan §5).
 */
export interface VdSessionScreenProps {
    readonly sessionId: string | undefined;
}

export function VdSessionScreen({ sessionId }: VdSessionScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();

    const parsed = sessionId === undefined ? null : VdSessionId.safeParse(sessionId);
    const query = useVdSessionQuery(parsed);
    const session = query.data;

    const send = useSendVdMessageMutation(parsed);
    const accept = useAcceptVdProposalMutation(parsed);
    const override = useOverrideVdProposalMutation(parsed);
    const generate = useGenerateVdDraftMutation(parsed);
    const requestReview = useRequestVdReviewMutation(parsed);

    const [draft, setDraft] = useState('');
    const [overrideOpen, setOverrideOpen] = useState(false);

    const actions: StatePanelActions = {
        onSend: (request: SendVdMessageRequest) => {
            send.mutate(request);
        },
        sending: send.isPending,
        onAccept: (acknowledged: boolean) => {
            accept.mutate({ acknowledgedDisclaimer: acknowledged });
        },
        accepting: accept.isPending,
        acceptFailure:
            toFailure(accept.error) === null ? null : t('virtualDietitian:targets.acceptFailed'),
        onOverride: () => {
            setOverrideOpen(true);
        },
        onRequestReview: () => {
            requestReview.mutate(undefined);
        },
        requestingReview: requestReview.isPending,
        reviewFailure:
            toFailure(requestReview.error) === null
                ? null
                : t('virtualDietitian:draft.requestFailed'),
        onGenerate: (preparationMode: PreparationMode) => {
            generate.mutate({
                weekStart: weekStartFor(todayIso()),
                preparationMode,
                acknowledgedDisclaimer: true,
            });
        },
        generating: generate.isPending,
        generateFailure:
            toFailure(generate.error) === null
                ? null
                : t('virtualDietitian:structure.generateFailed'),
        onContinue: () => {
            send.mutate({
                body: t('virtualDietitian:quickReplies.suggested_targets.looksRight'),
                answers: { acceptedTargets: true },
            });
        },
        onAskFor: (question: string) => {
            setDraft(question);
        },
    };

    return (
        <PageTransition>
            <Stack space="lg" testID="vd-session-screen">
                <Breadcrumbs
                    testID="vd-breadcrumbs"
                    items={[
                        {
                            key: 'virtual-dietitian',
                            testID: 'vd-breadcrumb-home',
                            label: t('virtualDietitian:session.back'),
                            onPress: () => {
                                router.push('/customer/virtual-dietitian');
                            },
                        },
                        {
                            key: 'session',
                            testID: 'vd-breadcrumb-session',
                            label:
                                session === undefined
                                    ? t('virtualDietitian:session.loading')
                                    : t(`virtualDietitian:states.${session.state}.label`),
                        },
                    ]}
                />

                {/*
                 * A malformed identifier is answered here rather than by asking the repository for
                 * it. `useVdSessionQuery` disables itself when the parameter does not parse, and a
                 * disabled query is *pending* forever — so without this branch a hand-typed link
                 * would sit on a skeleton for ever instead of saying what went wrong.
                 */}
                {parsed === null && sessionId !== undefined ? (
                    <EmptyState
                        testID="vd-session-empty"
                        title={t('virtualDietitian:session.notFoundTitle')}
                        body={t('virtualDietitian:session.notFoundBody')}
                    />
                ) : (
                    <QueryStates
                        query={query}
                        isEmpty={query.data === undefined && !query.isPending}
                        emptyTitle={t('virtualDietitian:session.notFoundTitle')}
                        emptyBody={t('virtualDietitian:session.notFoundBody')}
                        skeletonCount={2}
                        testID="vd-session"
                    >
                        {session === undefined ? null : (
                            <Stack space="lg">
                                <Heading level={1} testID="vd-session-title">
                                    {t('virtualDietitian:entry.title')}
                                </Heading>
                                <StateAnnouncer state={session.state} />

                                {/*
                                 * Mandatory on every state (plan §5). Outside the switch on purpose:
                                 * a per-panel disclaimer is a disclaimer that can go missing from one
                                 * panel.
                                 */}
                                <MedicalDisclaimer
                                    context={t('virtualDietitian:session.disclaimerContext')}
                                />

                                <View className="flex-col gap-6 lg:flex-row">
                                    <View className="flex-1 flex-col gap-6">
                                        <VdStatePanel session={session} actions={actions} />

                                        <Stack space="sm" testID="vd-conversation">
                                            <Heading level={2}>
                                                {t('virtualDietitian:session.conversationTitle')}
                                            </Heading>
                                            <MessageList messages={session.messages} />
                                            <Composer
                                                state={session.state}
                                                onSend={actions.onSend}
                                                sending={send.isPending}
                                                error={
                                                    toFailure(send.error) === null
                                                        ? null
                                                        : t('virtualDietitian:chat.failed')
                                                }
                                                draft={draft}
                                                onDraftChange={setDraft}
                                            />
                                        </Stack>
                                    </View>

                                    <View className="flex-1 flex-col gap-6 lg:basis-80 lg:grow-0">
                                        <Card padding="md" tone="raised" testID="vd-side-panel">
                                            <CollectedPanel messages={session.messages} />
                                        </Card>
                                        <Card padding="md" tone="raised" testID="vd-timeline-panel">
                                            <SessionTimeline session={session} />
                                        </Card>
                                    </View>
                                </View>

                                {overrideOpen && session.proposal !== null ? (
                                    <OverrideDialog
                                        open
                                        onClose={() => {
                                            setOverrideOpen(false);
                                        }}
                                        proposal={session.proposal}
                                        applying={override.isPending}
                                        failure={
                                            toFailure(override.error) === null
                                                ? null
                                                : t('virtualDietitian:override.failed')
                                        }
                                        onConfirm={(request) => {
                                            override.mutate(request, {
                                                onSuccess: () => {
                                                    setOverrideOpen(false);
                                                },
                                            });
                                        }}
                                    />
                                ) : null}
                            </Stack>
                        )}
                    </QueryStates>
                )}
            </Stack>
        </PageTransition>
    );
}
