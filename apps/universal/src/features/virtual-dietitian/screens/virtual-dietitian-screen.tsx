import {
    Badge,
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    ListItem,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../../data/hooks.ts';
import { useCreateVdSessionMutation, useVdSessionsQuery } from '../../../data/vd-hooks.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { VD_STATE_BADGE_TONE, VD_STATE_ICON } from '../state-presentation.ts';

/**
 * `/customer/virtual-dietitian` — the entry point and the session list.
 *
 * ## The framing is the feature
 *
 * A conversational nutrition assistant is exactly the kind of surface a person can mistake for
 * clinical advice, and the prompt is unambiguous: it must not present as a substitute for medical
 * care. So this screen states what the journey *is* and what it *is not* as two equally prominent
 * blocks before any control, carries the standing `MedicalDisclaimer`, and adds a second notice
 * saying that machine-generated suggestions are labelled wherever they appear. Three separate
 * statements, none of which is a footnote.
 *
 * The "is not" block includes the fact that no language model is connected. Saying so is not
 * humility about the prototype: a person who believes they are talking to a model will read the
 * scripted replies as reasoning about *them*, and they are not.
 *
 * ## Starting a session is a real write
 *
 * `createSession` goes through `VirtualDietitianRepository` and creates a session in the world, then
 * the router navigates to it. Nothing about that changes when the mock is replaced by the API
 * repository.
 */
export function VirtualDietitianScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();

    const sessions = useVdSessionsQuery();
    const create = useCreateVdSessionMutation();
    const createFailure = toFailure(create.error);

    const items = sessions.data?.items ?? [];

    return (
        <Stack space="lg" testID="virtual-dietitian-screen">
            <Stack space="sm">
                <Heading level={1} testID="vd-title">
                    {t('virtualDietitian:entry.title')}
                </Heading>
                <Text tone="secondary" testID="vd-lead">
                    {t('virtualDietitian:entry.lead')}
                </Text>
            </Stack>

            <MedicalDisclaimer context={t('virtualDietitian:session.disclaimerContext')} />

            <Callout
                testID="vd-ai-notice"
                role="note"
                tone="info"
                icon="prototype"
                title={t('virtualDietitian:aiNotice.title')}
                body={t('virtualDietitian:aiNotice.body')}
            />

            <Inline space="md" align="stretch" wrap>
                <Card padding="md" tone="raised" testID="vd-what-it-is" className="flex-1 basis-72">
                    <Stack space="xs">
                        <Heading level={2}>{t('virtualDietitian:entry.isTitle')}</Heading>
                        {(['isOne', 'isTwo', 'isThree'] as const).map((key) => (
                            <Text key={key} testID={`vd-what-it-is-${key}`} variant="caption">
                                {t(`virtualDietitian:entry.${key}`)}
                            </Text>
                        ))}
                    </Stack>
                </Card>

                <Card
                    padding="md"
                    tone="raised"
                    testID="vd-what-it-is-not"
                    className="flex-1 basis-72"
                >
                    <Stack space="xs">
                        <Inline space="xs" align="center">
                            <Heading level={2}>{t('virtualDietitian:entry.isNotTitle')}</Heading>
                            <Badge
                                testID="vd-what-it-is-not-badge"
                                tone="warning"
                                icon="warning"
                                label={t('virtualDietitian:origin.aiShort')}
                            />
                        </Inline>
                        {(['isNotOne', 'isNotTwo', 'isNotThree'] as const).map((key) => (
                            <Text key={key} testID={`vd-what-it-is-not-${key}`} variant="caption">
                                {t(`virtualDietitian:entry.${key}`)}
                            </Text>
                        ))}
                    </Stack>
                </Card>
            </Inline>

            <Card padding="md" tone="raised" testID="vd-start-card">
                <Stack space="sm">
                    <Heading level={2}>{t('virtualDietitian:entry.startTitle')}</Heading>
                    <Text tone="secondary">{t('virtualDietitian:entry.startBody')}</Text>
                    <Button
                        testID="vd-start"
                        variant="primary"
                        loading={create.isPending}
                        label={
                            create.isPending
                                ? t('virtualDietitian:entry.starting')
                                : t('virtualDietitian:entry.start')
                        }
                        onPress={() => {
                            create.mutate(
                                { useProfile: true },
                                {
                                    onSuccess: (session) => {
                                        router.push(
                                            `/customer/virtual-dietitian/${String(session.id)}`,
                                        );
                                    },
                                },
                            );
                        }}
                    />
                    {createFailure === null ? null : (
                        <Text
                            testID="vd-start-error"
                            tone="danger"
                            role="alert"
                            aria-live="assertive"
                        >
                            {t('virtualDietitian:entry.startFailed')}
                        </Text>
                    )}
                </Stack>
            </Card>

            <Stack space="sm">
                <Heading level={2} testID="vd-sessions-title">
                    {t('virtualDietitian:entry.sessionsTitle')}
                </Heading>

                <QueryStates
                    query={sessions}
                    isEmpty={items.length === 0}
                    emptyTitle={t('virtualDietitian:entry.sessionsEmptyTitle')}
                    emptyBody={t('virtualDietitian:entry.sessionsEmptyBody')}
                    skeletonCount={3}
                    testID="vd-sessions"
                >
                    <Stack space="xs" testID="vd-sessions-list">
                        {items.map((summary) => {
                            const updated = formatter.formatDate(summary.updatedAt, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            });

                            return (
                                <ListItem
                                    key={String(summary.id)}
                                    testID={`vd-session-${summary.state}`}
                                    title={summary.headline}
                                    description={t('virtualDietitian:entry.updated', {
                                        date: updated,
                                    })}
                                    accessibilityLabel={t('virtualDietitian:entry.openSession', {
                                        updated,
                                    })}
                                    chevron
                                    trailing={
                                        <Badge
                                            testID={`vd-session-${summary.state}-badge`}
                                            tone={VD_STATE_BADGE_TONE[summary.state]}
                                            icon={VD_STATE_ICON[summary.state]}
                                            label={t(
                                                `virtualDietitian:states.${summary.state}.label`,
                                            )}
                                        />
                                    }
                                    onPress={() => {
                                        router.push(
                                            `/customer/virtual-dietitian/${String(summary.id)}`,
                                        );
                                    }}
                                />
                            );
                        })}
                    </Stack>
                </QueryStates>
            </Stack>
        </Stack>
    );
}
