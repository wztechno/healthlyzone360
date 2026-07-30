import { isRateLimitFailure, isValidationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';
import type { Translate } from '@healthy360/validation';
import {
    Button,
    Card,
    Checkbox,
    Heading,
    Inline,
    PasswordInput,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { makeLoginSchema, toFormResolver } from '@healthy360/validation';
import type { LoginInput, LoginValues } from '@healthy360/validation';
import { Link, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useLoginMutation, useTwoFactorChallengeMutation } from '../data/hooks.ts';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

/**
 * Sign in.
 *
 * Three server outcomes are handled distinctly, because collapsing them is what makes an
 * authentication screen frustrating:
 *
 * * `validation.failed` → mapped onto the offending field, inline.
 * * `rate_limit.exceeded` → a message that says *how long*, not just "too many attempts".
 * * `two_factor_required` → not an error at all; the form advances to the challenge step.
 */
export function SignInScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const login = useLoginMutation();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();

    const [challengeId, setChallengeId] = useState<string | null>(null);

    const form = useForm<LoginInput, unknown, LoginValues>({
        resolver: toFormResolver(makeLoginSchema(translate)),
        defaultValues: { email: '', password: '', remember: false },
        mode: 'onSubmit',
    });

    const { formError, setFormError } = useFieldErrors();

    const onSubmit = useCallback(
        (values: LoginValues) => {
            setFormError(null);
            login.mutate(
                { email: values.email, password: values.password, remember: values.remember },
                {
                    onSuccess: (result) => {
                        if (result.status === 'two_factor_required') {
                            setChallengeId(result.challengeId);
                            return;
                        }
                        router.replace('/');
                    },
                    onError: (error: unknown) => {
                        const failure = toFailure(error);
                        setFormError(
                            applyServerFailure(failure, form.setError, ['email', 'password']) ??
                                signInFailureMessage(failure, describeFailure, translate),
                        );
                    },
                },
            );
        },
        [describeFailure, form, login, router, setFormError, translate],
    );

    if (challengeId !== null) {
        return (
            <TwoFactorChallenge
                challengeId={challengeId}
                onCancel={() => {
                    setChallengeId(null);
                }}
            />
        );
    }

    return (
        <Stack testID="sign-in-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="sign-in-title">
                    {t('auth:login.title')}
                </Heading>
                <Text tone="secondary">{t('auth:login.subtitle')}</Text>
            </Stack>

            {formError === null ? null : (
                <Card tone="danger" padding="sm">
                    <Text testID="sign-in-error" tone="danger" role="alert" aria-live="assertive">
                        {formError}
                    </Text>
                </Card>
            )}

            <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                    <TextInputField
                        testID="sign-in-email"
                        id="sign-in-email"
                        label={t('auth:login.emailLabel')}
                        placeholder={t('auth:login.emailPlaceholder')}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        textContentType="emailAddress"
                        required
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                    <PasswordInput
                        testID="sign-in-password"
                        id="sign-in-password"
                        label={t('auth:login.passwordLabel')}
                        autoComplete="current-password"
                        textContentType="password"
                        required
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="remember"
                render={({ field }) => (
                    <Checkbox
                        testID="sign-in-remember"
                        id="sign-in-remember"
                        label={t('auth:login.rememberLabel')}
                        checked={field.value === true}
                        onChange={field.onChange}
                    />
                )}
            />

            <Button
                testID="sign-in-submit"
                block
                label={t('auth:login.submit')}
                loading={login.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            <Inline space="xs">
                <Link testID="sign-in-forgot" href="/forgot-password" asChild>
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:login.forgotLink')}
                    </Text>
                </Link>
            </Inline>

            <Inline space="xs">
                <Text tone="secondary">{t('auth:login.registerPrompt')}</Text>
                <Link testID="sign-in-register" href="/register" asChild>
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:login.registerLink')}
                    </Text>
                </Link>
            </Inline>
        </Stack>
    );
}

/**
 * Sign-in has its own wording for two codes, because the generic ones are not good enough here: a
 * rate limit must say *how long*, and a rejected credential should not read like a server fault.
 */
function signInFailureMessage(
    failure: ApiFailure | null,
    fallback: (failure: ApiFailure | null) => string | null,
    t: Translate,
): string | null {
    if (failure === null) return null;
    if (isRateLimitFailure(failure)) {
        return t('auth:login.rateLimited', { seconds: failure.retryAfterSeconds });
    }
    if (failure.code === 'auth.invalid_credentials') return t('auth:login.failed');
    return fallback(failure);
}

interface TwoFactorChallengeProps {
    readonly challengeId: string;
    readonly onCancel: () => void;
}

/**
 * The second step of sign-in.
 *
 * Recovery codes are offered as a *mode switch* rather than a second always-visible field: two
 * inputs where only one applies is the classic way people lock themselves out of their own account.
 */
function TwoFactorChallenge({ challengeId, onCancel }: TwoFactorChallengeProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const challenge = useTwoFactorChallengeMutation();
    const describeFailure = useFailureMessage();

    const [code, setCode] = useState('');
    const [recovery, setRecovery] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = () => {
        setError(null);
        challenge.mutate(
            { challengeId, code, recovery },
            {
                onSuccess: () => {
                    router.replace('/');
                },
                onError: (caught: unknown) => {
                    const failure = toFailure(caught);
                    if (failure !== null && isValidationFailure(failure)) {
                        setError(failure.fields['code']?.[0] ?? failure.message);
                        return;
                    }
                    setError(describeFailure(failure));
                },
            },
        );
    };

    return (
        <Stack testID="two-factor-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="two-factor-title">
                    {t('auth:login.twoFactor.title')}
                </Heading>
                <Text tone="secondary">{t('auth:login.twoFactor.subtitle')}</Text>
            </Stack>

            <TextInputField
                testID="two-factor-code"
                id="two-factor-code"
                label={
                    recovery
                        ? t('auth:login.twoFactor.recoveryLabel')
                        : t('auth:login.twoFactor.codeLabel')
                }
                hint={
                    recovery
                        ? t('auth:login.twoFactor.recoveryHint')
                        : t('auth:login.twoFactor.codeHint')
                }
                keyboardType={recovery ? 'default' : 'number-pad'}
                autoCapitalize="characters"
                autoComplete="one-time-code"
                required
                value={code}
                onChangeText={setCode}
                {...(error === null ? {} : { error })}
            />

            <Button
                testID="two-factor-submit"
                block
                label={t('auth:login.twoFactor.submit')}
                loading={challenge.isPending}
                onPress={submit}
            />

            <Inline space="sm">
                <Button
                    testID="two-factor-toggle-recovery"
                    variant="ghost"
                    size="sm"
                    label={
                        recovery
                            ? t('auth:login.twoFactor.useCode')
                            : t('auth:login.twoFactor.useRecovery')
                    }
                    onPress={() => {
                        setRecovery((current) => !current);
                        setCode('');
                        setError(null);
                    }}
                />
                <Button
                    testID="two-factor-cancel"
                    variant="ghost"
                    size="sm"
                    label={t('auth:login.twoFactor.back')}
                    onPress={onCancel}
                />
            </Inline>
        </Stack>
    );
}
