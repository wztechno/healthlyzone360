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
import { View } from 'react-native';

import { toFailure, useResetPasswordMutation } from '../data/hooks.ts';
import {
    AuthBadge,
    AuthError,
    AuthField,
    AuthHint,
    AuthLink,
    AuthMeter,
    AuthSubmit,
    AuthText,
    AuthTick,
    AuthTitle,
} from '../ui/auth-form.tsx';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

const KNOWN_FIELDS = ['token', 'email', 'password', 'password_confirmation'] as const;

/**
 * Reset password, drawn as the accepted Reset-password board in the sign-in frame: "Choose a new
 * password", the new password with its strength meter and its confirmation (one eye for both), and
 * "Save new password"; then "Password updated". A link that cannot work is the board's expired pane.
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
    const [revealed, setRevealed] = useState(false);

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

    const eye = {
        revealed,
        onToggleReveal: () => {
            setRevealed((value) => !value);
        },
        showLabel: t('auth:changePassword.showPassword'),
        hideLabel: t('auth:changePassword.hidePassword'),
    };
    const backToSignIn = (
        <AuthLink
            testID="reset-password-back"
            label={t('auth:forgotPassword.backToSignIn')}
            onPress={() => {
                router.replace('/sign-in');
            }}
        />
    );

    if (token === '' || email === '') {
        // The board's "This reset link has expired" pane: a link without its token can never
        // succeed, so the form is not offered at all.
        return (
            <View testID="reset-password-screen" className="flex-col gap-3.5">
                <View testID="reset-password-missing-link" className="flex-col gap-3.5">
                    <AuthBadge icon="clock" tone="warning" />
                    <AuthTitle>{t('auth:resetPassword.missingLink')}</AuthTitle>
                    <AuthText>{t('auth:resetPassword.missingLinkBody')}</AuthText>
                </View>
                <AuthSubmit
                    testID="reset-password-request-new"
                    label={t('auth:resetPassword.requestNew')}
                    onPress={() => {
                        router.replace('/forgot-password');
                    }}
                />
                {backToSignIn}
            </View>
        );
    }

    if (done) {
        return (
            <View testID="reset-password-screen" className="flex-col items-center gap-3.5">
                <AuthTick />
                <AuthTitle testID="reset-password-success-title" centred>
                    {t('auth:resetPassword.successTitle')}
                </AuthTitle>
                <View role="status" aria-live="polite">
                    <AuthText centred>{t('auth:resetPassword.successBody')}</AuthText>
                </View>
                <View className="mt-2 w-full">
                    <AuthSubmit
                        testID="reset-password-sign-in"
                        label={t('auth:login.submit')}
                        onPress={() => {
                            router.replace('/sign-in');
                        }}
                    />
                </View>
            </View>
        );
    }

    return (
        <View testID="reset-password-screen" className="flex-col gap-3.5">
            <AuthBadge icon="keyRound" />
            <AuthTitle testID="reset-password-title">{t('auth:resetPassword.title')}</AuthTitle>
            <AuthText>{t('auth:resetPassword.subtitle')}</AuthText>

            {formError === null ? null : (
                <AuthError testID="reset-password-error" message={formError} />
            )}

            <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                    <>
                        <AuthField
                            testID="reset-password-password"
                            label={t('auth:resetPassword.passwordLabel')}
                            icon="lock"
                            placeholder={t('auth:resetPassword.passwordPlaceholder')}
                            autoComplete="new-password"
                            secret
                            {...eye}
                            value={field.value}
                            onChangeText={field.onChange}
                            onBlur={field.onBlur}
                            error={fieldState.error?.message}
                        />
                        <AuthMeter value={field.value} minimum={PASSWORD_MIN_LENGTH} />
                    </>
                )}
            />

            <Controller
                control={form.control}
                name="password_confirmation"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="reset-password-confirmation"
                        label={t('auth:resetPassword.passwordConfirmationLabel')}
                        icon="lock"
                        placeholder={t('auth:resetPassword.passwordConfirmationPlaceholder')}
                        autoComplete="new-password"
                        secret
                        {...eye}
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <AuthHint>{t('auth:register.passwordHint', { count: PASSWORD_MIN_LENGTH })}</AuthHint>

            <AuthSubmit
                testID="reset-password-submit"
                label={t('auth:resetPassword.submit')}
                busy={reset.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />
        </View>
    );
}
