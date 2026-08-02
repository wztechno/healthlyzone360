import { Button, Callout, Card, Heading, ListItem, Stack, Text } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useB2BApplicationQuery,
    useStartB2BApplicationMutation,
} from '../../../data/b2b-application-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { StatusPanel } from '../status-panel.tsx';
import { firstIncompleteStep, isApplicantEditable } from '../sections.ts';

/**
 * `/apply` — the door.
 *
 * ## What it decides
 *
 * There are three situations and this screen tells them apart before drawing anything:
 *
 * 1. **No application.** An invitation, what the person will need to hand, and a button that starts
 *    one. The "what you will need" list is not decoration — a person who discovers on step five that
 *    they need a passport scan they do not have goes away and does not come back.
 * 2. **An application they are still writing.** A resume control that goes to the *first incomplete
 *    step*, not to step one. Somebody who filled in the company yesterday and came back with the
 *    trade licence should land on what is left.
 * 3. **An application that is with us.** The status panel, in place. Not a redirect: a redirect
 *    loses the address they typed, and `/apply` is the address people bookmark.
 *
 * ## `null` is a value here, not an error
 *
 * `getApplication()` answers `null` for "you have never applied", which is the normal first visit.
 * Treating it as an empty state rather than a failure is what lets the invitation be the page rather
 * than an error recovery.
 */

const TEST_ID = 'b2b-apply-entry';

export function ApplyEntryScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const application = useB2BApplicationQuery();
    const start = useStartB2BApplicationMutation();

    const current = application.data ?? null;
    const startFailure = toFailure(start.error);

    const goToStep = (slug: string) => {
        router.push(`/apply/${slug}` as never);
    };

    return (
        <Stack space="lg" testID={TEST_ID}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-title`}>
                    {t('b2bApplication:entry.title')}
                </Heading>
                <Text tone="secondary">{t('b2bApplication:entry.body')}</Text>
            </Stack>

            {startFailure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-start-error`}
                    role="alert"
                    tone="danger"
                    title={startFailure.message}
                />
            )}

            <QueryStates
                query={application}
                // Never empty in the "nothing to show" sense: `null` is a real answer with its own
                // content, so the empty branch is unreachable and the invitation renders below.
                isEmpty={false}
                emptyTitle={t('b2bApplication:entry.title')}
                testID={TEST_ID}
            >
                {current === null ? (
                    <Stack space="md" testID={`${TEST_ID}-invitation`}>
                        <Card title={t('b2bApplication:entry.whatYouNeed')}>
                            <Stack space="xs">
                                <ListItem
                                    testID={`${TEST_ID}-need-registration`}
                                    title={t('b2bApplication:entry.needRegistration')}
                                />
                                <ListItem
                                    testID={`${TEST_ID}-need-identity`}
                                    title={t('b2bApplication:entry.needIdentity')}
                                />
                                <ListItem
                                    testID={`${TEST_ID}-need-terms`}
                                    title={t('b2bApplication:entry.needTerms')}
                                />
                            </Stack>
                        </Card>
                        <Button
                            testID={`${TEST_ID}-start`}
                            label={t('b2bApplication:entry.start')}
                            loading={start.isPending}
                            onPress={() => {
                                start.mutate(undefined, {
                                    onSuccess: (created) => {
                                        goToStep(firstIncompleteStep(created));
                                    },
                                });
                            }}
                        />
                    </Stack>
                ) : isApplicantEditable(current) ? (
                    <Stack space="md" testID={`${TEST_ID}-resume`}>
                        <Callout
                            tone="info"
                            role="status"
                            title={t('b2bApplication:entry.resume')}
                            body={t('b2bApplication:entry.resumeBody', {
                                date: current.createdAt,
                            })}
                        />
                        <Button
                            testID={`${TEST_ID}-continue`}
                            label={t('b2bApplication:entry.resume')}
                            onPress={() => {
                                goToStep(firstIncompleteStep(current));
                            }}
                        />
                        <Button
                            testID={`${TEST_ID}-status`}
                            variant="ghost"
                            label={t('b2bApplication:entry.viewStatus')}
                            onPress={() => {
                                router.push('/apply/status' as never);
                            }}
                        />
                    </Stack>
                ) : (
                    <StatusPanel
                        application={current}
                        testID={`${TEST_ID}-status-panel`}
                        onOpenStep={(slug) => {
                            goToStep(slug);
                        }}
                        onOpenAgreement={() => {
                            router.push('/apply/agreement' as never);
                        }}
                        onOpenProvisioning={() => {
                            router.push('/apply/provisioning' as never);
                        }}
                    />
                )}
            </QueryStates>
        </Stack>
    );
}
