import { Badge, Button, Callout, Card, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type {
    B2BApplication,
    B2BApplicationSection,
    B2BApplicationState,
    B2BDocumentKind,
    ReviewerRequest,
} from './repositories-shim.ts';
import { stepForSection } from './sections.ts';
import type { B2BStepSlug } from './sections.ts';

/**
 * One component, eleven states.
 *
 * ## Why one component rather than eleven screens
 *
 * The states differ in *what is true*, not in what the panel is for: a person opens this to find out
 * where their application stands and what, if anything, they have to do. Eleven screens would be
 * eleven copies of the same layout that drift apart, and the two states most likely to be
 * confused — `approved` and `agreement_pending` — would be the two most likely to end up
 * inconsistent. Keeping them in one table makes the difference between them a line of copy rather
 * than a file.
 *
 * ## The states this panel refuses to collapse
 *
 * `approved` is not `agreement_pending`. Approved means a reviewer said yes; agreement pending means
 * the terms are drafted and the next move is the applicant's. A panel showing "approved" for both
 * leaves somebody waiting for an email that is never coming.
 *
 * `declined` is not `withdrawn`. One is the platform's decision and the other is the applicant's,
 * and a person who withdrew their own application should not be told they were turned down.
 *
 * `provisioning` is not `provisioned`. Only the second means the buying surfaces exist.
 *
 * ## Reviewer requests link at the thing they are about
 *
 * A request naming `trade_terms` gets a control that goes to the trade-terms step; one naming a
 * document kind gets a control that goes to the documents step. A status panel that said "we need
 * more information" and left the person to find where would be making them re-read a form they
 * have already filled in.
 */

/** The tone each state is drawn in. Never colour alone — the label carries the meaning too. */
const STATE_TONE: Readonly<
    Record<B2BApplicationState, 'neutral' | 'info' | 'warning' | 'success' | 'danger'>
> = {
    draft: 'neutral',
    submitted: 'info',
    in_review: 'info',
    info_requested: 'warning',
    approved: 'success',
    agreement_pending: 'warning',
    agreement_signed: 'info',
    provisioning: 'info',
    provisioned: 'success',
    declined: 'danger',
    withdrawn: 'neutral',
};

export interface StatusPanelProps {
    readonly application: B2BApplication;
    /** Sends the person to a wizard step. Absent on surfaces where the wizard is unreachable. */
    readonly onOpenStep?: ((slug: B2BStepSlug) => void) | undefined;
    /** Sends the person to the agreement. Only meaningful while one is waiting to be accepted. */
    readonly onOpenAgreement?: (() => void) | undefined;
    readonly onOpenProvisioning?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export function StatusPanel({
    application,
    onOpenStep,
    onOpenAgreement,
    onOpenProvisioning,
    testID = 'b2b-status',
}: StatusPanelProps) {
    const { t } = useTranslation();

    const state = application.state;
    const open = application.reviewerRequests.filter((request) => request.resolvedAt === null);

    return (
        <Stack testID={testID} space="lg">
            <Stack space="xs">
                <View className="flex-row items-center gap-2">
                    <Badge
                        testID={`${testID}-badge`}
                        tone={STATE_TONE[state]}
                        label={t(`b2bApplication:status.${state}.label`)}
                    />
                    <Text tone="secondary" variant="caption" testID={`${testID}-reference`}>
                        {t('b2bApplication:reference', { reference: application.reference })}
                    </Text>
                </View>
                <Text testID={`${testID}-body`}>{t(`b2bApplication:status.${state}.body`)}</Text>
            </Stack>

            {/*
             * The half of a decision the applicant is shown. The reviewer's internal note is a
             * different column and never reaches this client (§4.8 denylist).
             */}
            {application.applicantMessage === null ? null : (
                <Card testID={`${testID}-message`} title={t('b2bApplication:status.messageFromUs')}>
                    <Text>{application.applicantMessage}</Text>
                </Card>
            )}

            {open.length > 0 ? (
                <Stack testID={`${testID}-requests`} space="sm">
                    <Text variant="bodyStrong">
                        {t('b2bApplication:status.reviewerRequestsTitle')}
                    </Text>
                    <View role="status" aria-live="polite">
                        <Text tone="secondary" variant="caption">
                            {t('b2bApplication:status.reviewerRequests', { count: open.length })}
                        </Text>
                    </View>
                    {open.map((request) => (
                        <RequestCard
                            key={request.id}
                            request={request}
                            testID={`${testID}-request-${request.id}`}
                            {...(onOpenStep === undefined ? {} : { onOpenStep })}
                        />
                    ))}
                </Stack>
            ) : null}

            {state === 'agreement_pending' && onOpenAgreement !== undefined ? (
                <Button
                    testID={`${testID}-open-agreement`}
                    label={t('b2bApplication:agreement.title')}
                    onPress={onOpenAgreement}
                />
            ) : null}

            {(state === 'agreement_signed' ||
                state === 'provisioning' ||
                state === 'provisioned') &&
            onOpenProvisioning !== undefined ? (
                <Button
                    testID={`${testID}-open-provisioning`}
                    variant="secondary"
                    label={t('b2bApplication:provisioning.title')}
                    onPress={onOpenProvisioning}
                />
            ) : null}

            {state === 'draft' && onOpenStep !== undefined ? (
                <Button
                    testID={`${testID}-resume`}
                    label={t('b2bApplication:entry.resume')}
                    onPress={() => {
                        onOpenStep('company');
                    }}
                />
            ) : null}
        </Stack>
    );
}

function RequestCard({
    request,
    onOpenStep,
    testID,
}: {
    readonly request: ReviewerRequest;
    readonly onOpenStep?: ((slug: B2BStepSlug) => void) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();

    return (
        <Callout
            testID={testID}
            tone="warning"
            role="note"
            title={t('b2bApplication:status.requestAskedOn', { date: request.requestedAt })}
            body={request.message}
            actions={
                onOpenStep === undefined ? undefined : (
                    <>
                        {request.sections.map((section: B2BApplicationSection) => (
                            <Button
                                key={section}
                                testID={`${testID}-section-${section}`}
                                variant="secondary"
                                size="sm"
                                label={t('b2bApplication:status.goToSection', {
                                    section: t(`b2bApplication:sections.${section}.title`),
                                })}
                                onPress={() => {
                                    onOpenStep(stepForSection(section));
                                }}
                            />
                        ))}
                        {request.documentKinds.map((kind: B2BDocumentKind) => (
                            <Button
                                key={kind}
                                testID={`${testID}-document-${kind}`}
                                variant="secondary"
                                size="sm"
                                label={t('b2bApplication:status.goToDocuments', {
                                    kind: t(`b2bApplication:documents.kinds.${kind}`),
                                })}
                                onPress={() => {
                                    onOpenStep('documents');
                                }}
                            />
                        ))}
                    </>
                )
            }
        />
    );
}
