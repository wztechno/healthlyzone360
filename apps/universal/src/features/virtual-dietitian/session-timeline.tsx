import type { VdSession } from '@healthy360/api-client/contracts';
import { Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { OriginBadge } from './origin-badge.tsx';
import type { VdOriginKind } from './state-presentation.ts';

/**
 * What has actually been decided in this session, and by whom.
 *
 * Built entirely from the timestamp fields the contract keeps separate on purpose — `acceptedAt`,
 * `overriddenAt`, `reviewRequestedAt`, `approvedAt` — rather than from the state, because the state
 * is where the session *is* and these are what happened on the way. An accepted proposal stays
 * visible after the session has moved on to a meal structure, which is the only way a person can
 * later answer "did I agree to this, or did it just appear?".
 *
 * Each entry carries the origin badge of whoever caused it, so acceptance (the person) and approval
 * (a professional) are never confusable.
 */
export interface SessionTimelineProps {
    readonly session: VdSession;
    readonly testID?: string | undefined;
}

interface TimelineEntry {
    readonly key: string;
    readonly labelKey: string;
    readonly at: string;
    readonly origin: VdOriginKind;
}

export function timelineEntries(session: VdSession): readonly TimelineEntry[] {
    const entries: TimelineEntry[] = [
        {
            key: 'created',
            labelKey: 'virtualDietitian:timeline.created',
            at: session.createdAt,
            origin: 'human',
        },
    ];

    const proposal = session.proposal;
    if (proposal?.acceptedAt != null) {
        entries.push({
            key: 'accepted',
            labelKey: 'virtualDietitian:timeline.accepted',
            at: proposal.acceptedAt,
            origin: 'human',
        });
    }
    if (proposal?.overriddenAt != null) {
        entries.push({
            key: 'overridden',
            labelKey: 'virtualDietitian:timeline.overridden',
            at: proposal.overriddenAt,
            origin: proposal.overriddenBy === null ? 'human' : 'dietitian',
        });
    }
    if (session.draftPlanId !== null) {
        entries.push({
            key: 'draft',
            labelKey: 'virtualDietitian:timeline.draft',
            at: session.updatedAt,
            origin: 'ai',
        });
    }
    if (session.reviewRequestedAt !== null) {
        entries.push({
            key: 'reviewRequested',
            labelKey: 'virtualDietitian:timeline.reviewRequested',
            at: session.reviewRequestedAt,
            origin: 'human',
        });
    }
    if (session.approvedAt !== null) {
        entries.push({
            key: 'approved',
            labelKey: 'virtualDietitian:timeline.approved',
            at: session.approvedAt,
            origin: 'dietitian',
        });
    }

    return entries;
}

export function SessionTimeline({ session, testID = 'vd-timeline' }: SessionTimelineProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const entries = timelineEntries(session);

    return (
        <Stack space="sm" testID={testID}>
            <Heading level={3}>{t('virtualDietitian:timeline.title')}</Heading>
            {entries.map((entry) => (
                <Stack key={entry.key} space="xs" testID={`${testID}-${entry.key}`}>
                    <Inline space="xs" align="center">
                        <OriginBadge kind={entry.origin} testID={`${testID}-${entry.key}-origin`} />
                    </Inline>
                    <Text variant="label">{t(entry.labelKey)}</Text>
                    <Text variant="caption" tone="secondary">
                        {formatter.formatDate(entry.at, {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                        })}
                    </Text>
                </Stack>
            ))}
        </Stack>
    );
}
