import {
    Button,
    Card,
    Heading,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { makeForgotPasswordSchema, toFormResolver } from '@healthy360/validation';
import type { ForgotPasswordValues } from '@healthy360/validation';
import { Link } from 'expo-router';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useForgotPasswordMutation } from '../data/hooks.ts';
import { applyServerFailure, useValidationTranslate } from './form-helpers.ts';

/**
 * Forgotten password.
 *
 * The confirmation is deliberately **neutral**: "if an account exists for this address, a link is
 * on its way". Telling the user whether the address is registered would turn this form into an
 * account-enumeration oracle, and it is the single most commonly leaked signal in an auth flow.
 */
export function ForgotPasswordScreen() {
    const { t } = useTranslation();
    const request = useForgotPasswordMutation();
    const translate = useValidationTranslate();
    const [sentTo, setSentTo] = useState<string | null>(null);

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
            <Stack testID="forgot-password-screen" space="lg">
                <Heading level={1} testID="forgot-password-sent-title">
                    {t('auth:forgotPassword.sentTitle')}
                </Heading>
                <Card tone="brand" padding="md">
                    <Text testID="forgot-password-sent-body" role="status" aria-live="polite">
                        {t('auth:forgotPassword.sentBody', { email: sentTo })}
                    </Text>
                </Card>
                <Link testID="forgot-password-back" href="/sign-in" asChild>
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:forgotPassword.backToSignIn')}
                    </Text>
                </Link>
            </Stack>
        );
    }

    return (
        <Stack testID="forgot-password-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="forgot-password-title">
                    {t('auth:forgotPassword.title')}
                </Heading>
                <Text tone="secondary">{t('auth:forgotPassword.subtitle')}</Text>
            </Stack>

            <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                    <TextInputField
                        testID="forgot-password-email"
                        id="forgot-password-email"
                        label={t('auth:forgotPassword.emailLabel')}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoComplete="email"
                        required
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Button
                testID="forgot-password-submit"
                block
                label={t('auth:forgotPassword.submit')}
                loading={request.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            <Inline space="xs">
                <Link testID="forgot-password-sign-in" href="/sign-in" asChild>
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:forgotPassword.backToSignIn')}
                    </Text>
                </Link>
            </Inline>
        </Stack>
    );
}
