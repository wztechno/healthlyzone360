import {
    Button,
    Callout,
    Card,
    Checkbox,
    Heading,
    Icon,
    Inline,
    ListItem,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { StoredNutritionTarget } from '@healthy360/api-client/contracts';
import type { ApiFailure } from '@healthy360/api-client';
import { useTranslation } from 'react-i18next';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { StepIntro } from './step-parts.tsx';

/**
 * Step 22 — the professional-review warning, shown when the engine asked for one.
 *
 * ## Why this is a step and not a toast
 *
 * `requiresProfessionalReview` is the engine refusing to let a figure stand on its own: an energy
 * floor was hit, a pace is aggressive, a body-mass index is far outside the range the equations were
 * fitted on, or a safety-critical restriction is present (`MockNutritionTargetEngine`, step 8). A
 * banner a person swipes away would be the interface pretending it said something. So it is a full
 * step with two real exits, and both of them are honest:
 *
 * * **Ask a dietitian to look at it** — a real mutation. It creates a `NutritionReview` in the
 *   `requested` state and puts the target on a professional's queue. Nothing about it is simulated.
 * * **Continue anyway** — also real, and deliberately available. Refusing to show a person their
 *   own numbers until a professional has signed them off would be a product that cannot be used;
 *   what the interface owes them is the reason, in plain words, before they choose. The
 *   acknowledgement is recorded rather than assumed.
 *
 * The reasons are the engine's own codes, translated. They are never rewritten into softer copy: a
 * person told "some of your answers need a second look" cannot tell whether it was their age or
 * their allergy, and the specific one is the whole information.
 */

export interface ReviewStepProps {
    readonly target: StoredNutritionTarget | null | undefined;
    readonly isPending: boolean;
    readonly failure: ApiFailure | null;
    readonly acknowledged: boolean;
    readonly onAcknowledge: (value: boolean) => void;
    readonly onRequestReview: () => void;
    readonly onContinue: () => void;
    readonly requesting: boolean;
    /** Set once the review request has been accepted, so the screen can show the pending state. */
    readonly reviewRequested: boolean;
    readonly requestFailure: ApiFailure | null;
    readonly errors: Readonly<Record<string, string>>;
}

export function ReviewStep({
    target,
    isPending,
    failure,
    acknowledged,
    onAcknowledge,
    onRequestReview,
    onContinue,
    requesting,
    reviewRequested,
    requestFailure,
    errors,
}: ReviewStepProps) {
    const { t } = useTranslation();

    if (isPending) {
        return (
            <Stack space="sm" testID="onboarding-review-loading">
                <Skeleton heightClassName="h-8" widthClassName="w-2/3" />
                <Skeleton heightClassName="h-24" />
            </Stack>
        );
    }

    if (failure !== null) {
        return (
            <Callout
                testID="onboarding-review-error"
                role="alert"
                tone="danger"
                title={t('onboarding:steps.review.errorTitle')}
                body={t('onboarding:steps.review.errorBody')}
                actions={
                    <Button
                        testID="onboarding-review-error-continue"
                        variant="secondary"
                        label={t('onboarding:steps.review.continue')}
                        onPress={onContinue}
                    />
                }
            />
        );
    }

    const reasons = target?.result.reviewReasons ?? [];

    return (
        <Stack space="lg" testID="onboarding-review">
            <StepIntro
                title={t('onboarding:steps.review.title')}
                lead={t('onboarding:steps.review.lead')}
                testID="onboarding-review"
            />

            <Callout
                testID="onboarding-review-warning"
                role="alert"
                tone="warning"
                title={t('onboarding:steps.review.warningTitle')}
                body={t('onboarding:steps.review.warningBody')}
            />

            <Stack space="sm" testID="onboarding-review-reasons">
                <Heading level={3}>{t('onboarding:steps.review.reasonsTitle')}</Heading>
                {reasons.length === 0 ? (
                    <Text tone="secondary" testID="onboarding-review-reasons-empty">
                        {t('onboarding:steps.review.reasonsEmpty')}
                    </Text>
                ) : (
                    <Card padding="none">
                        {/*
                         * The leading glyph is decorative rather than a labelled badge: the row's
                         * title already says what the reason is, and a badge whose label repeated
                         * it would simply be announced twice.
                         */}
                        {reasons.map((reason) => (
                            <ListItem
                                key={reason}
                                testID={`onboarding-review-reason-${reason}`}
                                title={t(`nutrition:reviewReasons.${reason}.title`, {
                                    defaultValue: reason,
                                })}
                                description={t(`nutrition:reviewReasons.${reason}.body`, {
                                    defaultValue: t('onboarding:steps.review.reasonFallback'),
                                })}
                                leading={<Icon name="warning" className="text-warning-strong" />}
                            />
                        ))}
                    </Card>
                )}
            </Stack>

            <MedicalDisclaimer context={t('onboarding:disclaimerContext')} />

            {reviewRequested ? (
                <Callout
                    testID="onboarding-review-requested"
                    role="status"
                    tone="success"
                    title={t('onboarding:steps.review.requestedTitle')}
                    body={t('onboarding:steps.review.requestedBody')}
                />
            ) : null}

            {requestFailure === null ? null : (
                <Callout
                    testID="onboarding-review-request-error"
                    role="alert"
                    tone="danger"
                    title={t('onboarding:steps.review.requestErrorTitle')}
                    body={t('onboarding:steps.review.requestErrorBody')}
                />
            )}

            <Checkbox
                testID="onboarding-review-acknowledge"
                label={t('onboarding:steps.review.acknowledge')}
                description={t('onboarding:steps.review.acknowledgeDescription')}
                checked={acknowledged}
                onChange={onAcknowledge}
                {...(errors['professionalReviewAcknowledged'] === undefined
                    ? {}
                    : { error: errors['professionalReviewAcknowledged'] })}
            />

            <Inline space="sm" wrap>
                <Button
                    testID="onboarding-review-request"
                    label={t('onboarding:steps.review.requestReview')}
                    loading={requesting}
                    disabled={reviewRequested || target === null || target === undefined}
                    onPress={onRequestReview}
                />
                {/*
                 * Enabled even before the box is ticked, and validated on press.
                 *
                 * A disabled control explains nothing: a person who has not noticed the checkbox
                 * gets a button that silently refuses, with no way to find out why. Pressing it
                 * instead surfaces the message on the acknowledgement itself, which is both where
                 * the problem is and what a screen reader announces. It is also the same behaviour
                 * as every other step's Next, so the wizard does not change its rules at the end.
                 */}
                <Button
                    testID="onboarding-review-continue"
                    variant="secondary"
                    label={t('onboarding:steps.review.continue')}
                    accessibilityHint={t('onboarding:steps.review.continueHint')}
                    onPress={onContinue}
                />
            </Inline>
        </Stack>
    );
}
