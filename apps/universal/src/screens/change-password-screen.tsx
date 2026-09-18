import { Button, Card, Heading, PasswordInput, Stack, Text } from '@healthy360/design-system';
import {
    PASSWORD_MIN_LENGTH,
    makeUpdatePasswordSchema,
    toFormResolver,
} from '@healthy360/validation';
import type { UpdatePasswordValues } from '@healthy360/validation';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useUpdatePasswordMutation } from '../data/hooks.ts';
import { useAccessState } from '../session/session-provider.tsx';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

const KNOWN_FIELDS = ['current_password', 'password', 'password_confirmation'] as const;

/**
 * Change password, from inside a live session.
 *
 * This is where `resolveLandingRoute()` parks a person whose account an administrator opened for
 * them. The distinction it draws matters: an account that *must* change reads as an obligation
 * with the reason stated — somebody else knows this password — while anybody arriving here by
 * choice gets an ordinary settings form. Same fields, different sentence, and the difference is
 * what stops the forced case reading like an error the person caused.
 *
 * Unlike a reset, the session survives, so success continues into the application rather than
 * bouncing back to the sign-in form. The route out is `/`, which re-runs the landing resolver on a
 * `/me` the mutation has already invalidated: the flag is now false, and the same resolver that
 * sent them here sends them on to their workspace.
 */
export function ChangePasswordScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const update = useUpdatePasswordMutation();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const { formError, setFormError } = useFieldErrors();
    const [done, setDone] = useState(false);

    const forced = useAccessState().mustChangePassword === true;

    const form = useForm<
        { current_password: string; password: string; password_confirmation: string },
        unknown,
        UpdatePasswordValues
    >({
        resolver: toFormResolver(makeUpdatePasswordSchema(translate)),
        defaultValues: { current_password: '', password: '', password_confirmation: '' },
        mode: 'onSubmit',
    });

    const onSubmit = useCallback(
        (values: UpdatePasswordValues) => {
            setFormError(null);
            update.mutate(
                {
                    currentPassword: values.current_password,
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
        [describeFailure, form, setFormError, update],
    );

    if (done) {
        return (
            <Stack testID="change-password-screen" space="lg">
                <Heading level={1} testID="change-password-success-title">
                    {t('auth:changePassword.successTitle')}
                </Heading>
                <Card tone="brand" padding="md">
                    <Text role="status" aria-live="polite">
                        {t('auth:changePassword.successBody')}
                    </Text>
                </Card>
                <Button
                    testID="change-password-continue"
                    block
                    label={t('auth:changePassword.continueLabel')}
                    onPress={() => {
                        router.replace('/');
                    }}
                />
            </Stack>
        );
    }

    return (
        <Stack testID="change-password-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="change-password-title">
                    {forced
                        ? t('auth:changePassword.title')
                        : t('auth:changePassword.optionalTitle')}
                </Heading>
                <Text tone="secondary" testID="change-password-subtitle">
                    {forced
                        ? t('auth:changePassword.subtitle')
                        : t('auth:changePassword.optionalSubtitle')}
                </Text>
            </Stack>

            {formError === null ? null : (
                <Card tone="danger" padding="sm">
                    <Text
                        testID="change-password-error"
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
                name="current_password"
                render={({ field, fieldState }) => (
                    <PasswordInput
                        testID="change-password-current"
                        id="change-password-current"
                        label={t('auth:changePassword.currentLabel')}
                        {...(forced ? { hint: t('auth:changePassword.currentHint') } : {})}
                        autoComplete="current-password"
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
                        testID="change-password-new"
                        id="change-password-new"
                        label={t('auth:changePassword.passwordLabel')}
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
                        testID="change-password-confirmation"
                        id="change-password-confirmation"
                        label={t('auth:changePassword.passwordConfirmationLabel')}
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
                testID="change-password-submit"
                block
                label={t('auth:changePassword.submit')}
                loading={update.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />
        </Stack>
    );
}
