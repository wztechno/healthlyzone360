import {
    Button,
    Card,
    EmptyState,
    Heading,
    PasswordInput,
    Stack,
    Text,
} from '@healthy360/design-system';
import {
    PASSWORD_MIN_LENGTH,
    makeResetPasswordSchema,
    toFormResolver,
} from '@healthy360/validation';
import type { ResetPasswordValues } from '@healthy360/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useResetPasswordMutation } from '../data/hooks.ts';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

const KNOWN_FIELDS = ['token', 'email', 'password', 'password_confirmation'] as const;

/**
 * Reset password.
 *
 * The token and the address come from the emailed link (`?token=…&email=…`). Arriving without them
 * is not an error to complain about after a failed submit — the form cannot possibly succeed, so it
 * is not shown at all.
 */
export function ResetPasswordScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams<{ token?: string; email?: string }>();
    const reset = useResetPasswordMutation();
    const { formError, setFormError } = useFieldErrors();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const [done, setDone] = useState(false);

    const token = typeof params.token === 'string' ? params.token : '';
    const email = typeof params.email === 'string' ? params.email : '';

    const form = useForm<
        { token: string; email: string; password: string; password_confirmation: string },
        unknown,
        ResetPasswordValues
    >({
        resolver: toFormResolver(makeResetPasswordSchema(translate)),
        defaultValues: { token, email, password: '', password_confirmation: '' },
        mode: 'onSubmit',
    });

    const onSubmit = useCallback(
        (values: ResetPasswordValues) => {
            setFormError(null);
            reset.mutate(
                {
                    token: values.token,
                    email: values.email,
                    password: values.password,
                    passwordConfirmation: values.password_confirmation,
                },
                {
                    onSuccess: () => {
                        setDone(true);
                    },
                    onError: (error: unknown) => {
                        const failure = toFailure(error);
                        const leftover = applyServerFailure(failure, form.setError, [
                            ...KNOWN_FIELDS,
                        ]);
                        setFormError(leftover ?? describeFailure(failure));
                    },
                },
            );
        },
        [describeFailure, form, reset, setFormError],
    );

    if (token === '' || email === '') {
        return (
            <Stack testID="reset-password-screen" space="lg">
                <EmptyState
                    testID="reset-password-missing-link"
                    title={t('auth:resetPassword.missingLink')}
                    body={t('auth:resetPassword.missingLinkBody')}
                    actions={
                        <Button
                            testID="reset-password-request-new"
                            label={t('auth:resetPassword.requestNew')}
                            onPress={() => {
                                router.replace('/forgot-password');
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (done) {
        return (
            <Stack testID="reset-password-screen" space="lg">
                <Heading level={1} testID="reset-password-success-title">
                    {t('auth:resetPassword.successTitle')}
                </Heading>
                <Card tone="brand" padding="md">
                    <Text role="status" aria-live="polite">
                        {t('auth:resetPassword.successBody')}
                    </Text>
                </Card>
                <Button
                    testID="reset-password-sign-in"
                    block
                    label={t('auth:login.submit')}
                    onPress={() => {
                        router.replace('/sign-in');
                    }}
                />
            </Stack>
        );
    }

    return (
        <Stack testID="reset-password-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="reset-password-title">
                    {t('auth:resetPassword.title')}
                </Heading>
                <Text tone="secondary">{t('auth:resetPassword.subtitle')}</Text>
            </Stack>

            {formError === null ? null : (
                <Card tone="danger" padding="sm">
                    <Text
                        testID="reset-password-error"
                        tone="danger"
                        role="alert"
                        aria-live="assertive"
                    >
                        {formError}
                    </Text>
                </Card>
            )}

            <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                    <PasswordInput
                        testID="reset-password-password"
                        id="reset-password-password"
                        label={t('auth:resetPassword.passwordLabel')}
                        hint={t('auth:register.passwordHint', { count: PASSWORD_MIN_LENGTH })}
                        autoComplete="new-password"
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
                name="password_confirmation"
                render={({ field, fieldState }) => (
                    <PasswordInput
                        testID="reset-password-confirmation"
                        id="reset-password-confirmation"
                        label={t('auth:resetPassword.passwordConfirmationLabel')}
                        autoComplete="new-password"
                        required
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Button
                testID="reset-password-submit"
                block
                label={t('auth:resetPassword.submit')}
                loading={reset.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />
        </Stack>
    );
}
