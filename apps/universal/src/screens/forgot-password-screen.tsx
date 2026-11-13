import { makeForgotPasswordSchema, toFormResolver } from '@healthy360/validation';
import type { ForgotPasswordValues } from '@healthy360/validation';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure, useForgotPasswordMutation } from '../data/hooks.ts';
import { safeReturnTo, withReturnTo } from '../navigation/return-to.ts';
import {
    AuthBadge,
    AuthField,
    AuthLink,
    AuthSubmit,
    AuthText,
    AuthTick,
    AuthTitle,
} from '../ui/auth-form.tsx';
import { applyServerFailure, useValidationTranslate } from './form-helpers.ts';

export interface ForgotPasswordScreenProps {
    /** The route's raw `?returnTo=`, passed back to sign-in untouched. */
    readonly returnTo?: string | undefined;
}

/**
 * Forgotten password, drawn as the accepted Forgot-password board in the sign-in frame: the key
 * badge, "Reset your password", the email field and "Send reset link"; then the tick and "Check
 * your email".
 *
 * The confirmation is deliberately **neutral**: "if an account exists for this address, a link is
 * on its way". Telling the user whether the address is registered would turn this form into an
 * account-enumeration oracle, and it is the single most commonly leaked signal in an auth flow.
 *
 * "Back to sign in" **replaces** this entry rather than pushing a second `/sign-in` on top of the
 * first, and hands back the `?returnTo=` the sign-in page was carrying — so the detour through
 * here neither loses where the person started nor leaves Back cycling between two forms (AUTH-05).
 */
export function ForgotPasswordScreen({ returnTo: rawReturnTo }: ForgotPasswordScreenProps = {}) {
    const { t } = useTranslation();
    const request = useForgotPasswordMutation();
    const translate = useValidationTranslate();
    const [sentTo, setSentTo] = useState<string | null>(null);
    const router = useRouter();
    const signInHref = withReturnTo('/sign-in', safeReturnTo(rawReturnTo));
    const backToSignIn = () => {
        router.replace(signInHref as never);
    };

    const form = useForm<{ email: string }, unknown, ForgotPasswordValues>({
        resolver: toFormResolver(makeForgotPasswordSchema(translate)),
        defaultValues: { email: '' },
        mode: 'onSubmit',
    });

    const onSubmit = useCallback(
        (values: ForgotPasswordValues) => {
            request.mutate(
                { email: values.email },
                {
                    onSuccess: () => {
                        setSentTo(values.email);
                    },
                    onError: (error: unknown) => {
                        applyServerFailure(toFailure(error), form.setError, ['email']);
                    },
                },
            );
        },
        [form, request],
    );

    if (sentTo !== null) {
        return (
            <View testID="forgot-password-screen" className="flex-col items-center gap-3.5">
                <AuthTick />
                <AuthTitle testID="forgot-password-sent-title" centred>
                    {t('auth:forgotPassword.sentTitle')}
                </AuthTitle>
                <View role="status" aria-live="polite">
                    <AuthText testID="forgot-password-sent-body" centred>
                        {t('auth:forgotPassword.sentBody', { email: sentTo })}
                    </AuthText>
                </View>
                <AuthLink
                    testID="forgot-password-back"
                    label={t('auth:forgotPassword.backToSignIn')}
                    onPress={backToSignIn}
                />
            </View>
        );
    }

    return (
        <View testID="forgot-password-screen" className="flex-col gap-3.5">
            <AuthBadge icon="keyRound" />
            <AuthTitle testID="forgot-password-title">{t('auth:forgotPassword.title')}</AuthTitle>
            <AuthText>{t('auth:forgotPassword.subtitle')}</AuthText>

            <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="forgot-password-email"
                        label={t('auth:forgotPassword.emailLabel')}
                        icon="send"
                        placeholder={t('auth:login.emailPlaceholder')}
                        keyboardType="email-address"
                        autoComplete="email"
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <AuthSubmit
                testID="forgot-password-submit"
                label={t('auth:forgotPassword.submit')}
                busy={request.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            <AuthLink
                testID="forgot-password-sign-in"
                label={t('auth:forgotPassword.backToSignIn')}
                onPress={backToSignIn}
            />
        </View>
    );
}
