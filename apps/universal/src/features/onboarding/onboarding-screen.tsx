import { Button, Callout, Inline, Stack, Stepper } from '@healthy360/design-system';
import type { ApiFailure } from '@healthy360/api-client';
import type { StoredNutritionTarget } from '@healthy360/api-client/contracts';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCurrentTargetsQuery,
    useRequestNutritionReviewMutation,
    useSaveTargetsMutation,
    useTargetCalculationQuery,
} from '../../data/nutrition-hooks.ts';
import { useValidationTranslate } from '../../screens/form-helpers.ts';
import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { enforcedConstraintsOf } from './constraints.ts';
import { useOnboarding } from './onboarding-provider.tsx';
import { ReviewStep } from './review-step.tsx';
import { validateStep } from './schemas.ts';
import type { StepErrors } from './schemas.ts';
import { StepBody } from './step-body.tsx';
import { SummaryStep } from './summary-step.tsx';
import {
    FIRST_ONBOARDING_STEP,
    ONBOARDING_STEP_COUNT,
    nextStep,
    onboardingStep,
    onboardingStepPath,
    previousStep,
} from './steps.ts';
import type { OnboardingStepSlug } from './steps.ts';
import { firstIncompleteStep, isStepReachable, toTargetRequest } from './state.ts';

/**
 * The wizard shell: progress, one step, and the two ways out of it.
 *
 * ## Prerequisites are a redirect, not a disabled button
 *
 * A deep link to step 18 with nothing answered lands on step 1. That rule is `isStepReachable` —
 * every earlier step complete — and it is enforced here rather than in the route file, because the
 * route file has no access to the answers and because the same rule has to hold for the summary's
 * edit links, the browser's back button and a bookmark from last week.
 *
 * The redirect is safe to compute during render: the answers are local reducer state, delivered
 * synchronously, so there is none of the batched-cache-notification race that makes
 * `useSettledCondition` necessary for session-derived redirects (`src/access/gate.tsx`). Adding a
 * tick's delay here would only give a person a frame of the wrong step.
 *
 * ## What "Next" actually does
 *
 * On steps 1 to 20, it validates the current step's schema and moves on. On step 21 it *saves*: the
 * answers become a `NutritionTargetRequest`, the repository stores the computed target, and the
 * destination depends on what the engine said — the warning step when a review is called for, the
 * nutrition page when it is not. Step 22 has its own two exits and no Next.
 */

export interface OnboardingScreenProps {
    readonly slug: OnboardingStepSlug;
}

export function OnboardingScreen({ slug }: OnboardingScreenProps) {
    const { t } = useTranslation();
    const validationTranslate = useValidationTranslate();
    const router = useRouter();
    const { answers, dispatch } = useOnboarding();

    const [errors, setErrors] = useState<StepErrors>({});
    const [reviewRequested, setReviewRequested] = useState(false);

    const step = onboardingStep(slug);
    const reachable = isStepReachable(slug, answers);

    /* ── data ─────────────────────────────────────────────────────────────────────────────── */

    const storedTargets = useCurrentTargetsQuery(true);
    const enforced = enforcedConstraintsOf(storedTargets.data?.result.request.constraints);

    // The preview only fires on the summary: calculating on every step would be twenty-one
    // requests nobody asked for, and the query is keyed by its inputs so nothing recomputes when
    // the person steps back and forward again.
    const previewRequest = slug === 'summary' ? toTargetRequest(answers) : null;
    const preview = useTargetCalculationQuery(previewRequest);

    const save = useSaveTargetsMutation();
    const requestReview = useRequestNutritionReviewMutation();

    const saveFailure: ApiFailure | null = toFailure(save.error);

    /* ── navigation ───────────────────────────────────────────────────────────────────────── */

    const goTo = useCallback(
        (target: OnboardingStepSlug) => {
            setErrors({});
            router.push(onboardingStepPath(target) as never);
        },
        [router],
    );

    const finish = useCallback(
        (stored: StoredNutritionTarget) => {
            if (stored.result.requiresProfessionalReview) {
                goTo('review');
                return;
            }
            router.replace('/customer/nutrition' as never);
        },
        [goTo, router],
    );

    const submit = useCallback(() => {
        const request = toTargetRequest(answers);
        if (request === null) {
            const missing = firstIncompleteStep(answers);
            if (missing !== null) goTo(missing);
            return;
        }
        save.mutate({ source: request, acknowledgedDisclaimer: true }, { onSuccess: finish });
    }, [answers, finish, goTo, save]);

    const onNext = useCallback(() => {
        const found = validateStep(slug, answers, validationTranslate);
        setErrors(found);
        if (Object.keys(found).length > 0) return;

        if (slug === 'summary') {
            submit();
            return;
        }
        const target = nextStep(slug);
        if (target !== null) goTo(target);
    }, [answers, goTo, slug, submit, validationTranslate]);

    const onBack = useCallback(() => {
        const target = previousStep(slug);
        if (target !== null) goTo(target);
    }, [goTo, slug]);

    const onRequestReview = useCallback(() => {
        const targetId = storedTargets.data?.id;
        if (targetId === undefined) return;
        requestReview.mutate(
            { targetId, urgency: 'soon' },
            {
                onSuccess: () => {
                    setReviewRequested(true);
                },
            },
        );
    }, [requestReview, storedTargets.data?.id]);

    /**
     * Skipping.
     *
     * Body fat is the one skippable step where "skip" is an *answer* rather than an absence: it
     * records that the person chose not to supply a figure, which is what keeps the step complete
     * and stops the prerequisite redirect bouncing them back to it. Every other optional step is
     * already complete when empty, so skipping is plain navigation.
     */
    const onSkip = useCallback(() => {
        if (slug === 'body-fat') {
            dispatch({
                type: 'set',
                patch: { bodyFatSkipped: true, bodyFatPercentage: null },
            });
        }
        const target = nextStep(slug);
        if (target !== null) goTo(target);
    }, [dispatch, goTo, slug]);

    const onContinue = useCallback(() => {
        const found = validateStep('review', answers, validationTranslate);
        setErrors(found);
        if (Object.keys(found).length > 0) return;
        router.replace('/customer/nutrition' as never);
    }, [answers, router, validationTranslate]);

    /* ── guards ───────────────────────────────────────────────────────────────────────────── */

    if (!reachable) {
        const destination = firstIncompleteStep(answers) ?? FIRST_ONBOARDING_STEP;
        return <Redirect href={onboardingStepPath(destination) as never} />;
    }

    const stepLabel = t(`onboarding:stepLabels.${slug}`);
    const isLastAnswerStep = slug === 'summary';
    const showFooter = slug !== 'review';
    // Body fat stops being skippable the moment the person asks for the equation that needs it.
    const skippable =
        step.optional && !(slug === 'body-fat' && answers.calculationBasis === 'body_composition');

    return (
        <Stack space="lg" testID="onboarding-screen">
            <Stepper
                testID="onboarding-stepper"
                label={t('onboarding:progressLabel')}
                current={step.position}
                total={ONBOARDING_STEP_COUNT}
                stepLabel={stepLabel}
            />

            {slug === 'summary' ? (
                <SummaryStep
                    answers={answers}
                    errors={errors}
                    enforced={enforced}
                    onAcknowledge={(summaryAcknowledged) => {
                        dispatch({ type: 'set', patch: { summaryAcknowledged } });
                    }}
                    onEdit={goTo}
                    preview={{
                        data: preview.data,
                        isPending: preview.isPending && previewRequest !== null,
                        error: preview.error,
                    }}
                />
            ) : slug === 'review' ? (
                <ReviewStep
                    target={storedTargets.data}
                    isPending={storedTargets.isPending}
                    failure={toFailure(storedTargets.error)}
                    acknowledged={answers.professionalReviewAcknowledged}
                    onAcknowledge={(professionalReviewAcknowledged) => {
                        dispatch({
                            type: 'set',
                            patch: { professionalReviewAcknowledged },
                        });
                    }}
                    onRequestReview={onRequestReview}
                    onContinue={onContinue}
                    requesting={requestReview.isPending}
                    reviewRequested={reviewRequested}
                    requestFailure={toFailure(requestReview.error)}
                    errors={errors}
                />
            ) : (
                <>
                    <StepBody
                        slug={slug}
                        answers={answers}
                        errors={errors}
                        dispatch={dispatch}
                        enforced={enforced}
                        enforcedPending={storedTargets.isPending}
                        enforcedFailed={toFailure(storedTargets.error) !== null}
                    />
                    {/*
                     * The disclaimer travels with the step rather than with the shell: two thirds of
                     * the steps ask about the body or produce a figure, and the three that do not —
                     * cuisines, budget, meal times — should not carry a medical notice for the sake
                     * of uniformity. `ONBOARDING_STEPS[].medical` is the single list.
                     */}
                    {step.medical && slug !== 'introduction' ? (
                        <MedicalDisclaimer context={t('onboarding:disclaimerContext')} />
                    ) : null}
                </>
            )}

            {saveFailure === null ? null : (
                <Callout
                    testID="onboarding-save-error"
                    role="alert"
                    tone="danger"
                    title={t('onboarding:saveErrorTitle')}
                    body={t('onboarding:saveErrorBody')}
                    actions={
                        <Button
                            testID="onboarding-save-retry"
                            variant="secondary"
                            label={t('onboarding:saveRetry')}
                            loading={save.isPending}
                            onPress={submit}
                        />
                    }
                />
            )}

            {showFooter ? (
                <Inline space="sm" wrap testID="onboarding-navigation">
                    <Button
                        testID="onboarding-back"
                        variant="quiet"
                        label={t('onboarding:back')}
                        disabled={previousStep(slug) === null}
                        onPress={onBack}
                    />
                    <Button
                        testID="onboarding-next"
                        label={isLastAnswerStep ? t('onboarding:finish') : t('onboarding:next')}
                        loading={save.isPending}
                        onPress={onNext}
                    />
                    {skippable ? (
                        <Button
                            testID="onboarding-skip"
                            variant="ghost"
                            label={t('onboarding:skip')}
                            accessibilityHint={t('onboarding:skipHint')}
                            onPress={onSkip}
                        />
                    ) : null}
                </Inline>
            ) : null}
        </Stack>
    );
}

/**
 * `/customer/onboarding` — resolve to wherever the person actually is.
 *
 * Its own component rather than a line in the route file so the resolution is testable without a
 * router: "where does a half-finished wizard resume?" is a rule, and rules belong beside the state
 * they read.
 */
export function OnboardingIndexScreen() {
    const { answers } = useOnboarding();
    const destination = useMemo(
        () => firstIncompleteStep(answers) ?? FIRST_ONBOARDING_STEP,
        [answers],
    );

    return <Redirect href={onboardingStepPath(destination) as never} />;
}
