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
import { PASSWORD_MIN_LENGTH, makeRegisterSchema, toFormResolver } from '@healthy360/validation';
import type { RegisterInput, RegisterValues } from '@healthy360/validation';
import { Link, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useRegisterMutation } from '../data/hooks.ts';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

/** Field paths this form owns, so a server error for anything else surfaces as a banner. */
const KNOWN_FIELDS = [
    'name',
    'email',
    'password',
    'password_confirmation',
    'accept_terms',
    'accept_privacy',
] as const;

/**
 * Registration.
 *
 * The schema is `@healthy360/validation`'s, translated at render time, so the client mirrors the
 * server's password policy without keeping a second copy of it. The two consents are booleans
 * refined to `true`: an unticked box fails validation rather than quietly submitting `false`, and
 * unlike a `z.literal(true)` the unchecked initial state is still expressible.
 */
export function RegisterScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const register = useRegisterMutation();
    const { formError, setFormError } = useFieldErrors();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();

    const form = useForm<RegisterInput, unknown, RegisterValues>({
        resolver: toFormResolver(makeRegisterSchema(translate)),
        defaultValues: {
            name: '',
            email: '',
            password: '',
            password_confirmation: '',
            accept_terms: false,
            accept_privacy: false,
        },
        mode: 'onSubmit',
    });

    const onSubmit = useCallback(
        (values: RegisterValues) => {
            setFormError(null);
            register.mutate(
                {
                    name: values.name,
                    email: values.email,
                    password: values.password,
                    passwordConfirmation: values.password_confirmation,
                    acceptTerms: values.accept_terms,
                    acceptPrivacy: values.accept_privacy,
                },
                {
                    onSuccess: () => {
                        router.replace('/verify-email');
                    },
                    onError: (error: unknown) => {
                        const failure = toFailure(error);
                        setFormError(
                            applyServerFailure(failure, form.setError, [...KNOWN_FIELDS]) ??
                                describeFailure(failure),
                        );
                    },
                },
            );
        },
        [describeFailure, form, register, router, setFormError],
    );

    return (
        <Stack testID="register-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="register-title">
                    {t('auth:register.title')}
                </Heading>
                <Text tone="secondary">{t('auth:register.subtitle')}</Text>
            </Stack>

            {formError === null ? null : (
                <Card tone="danger" padding="sm">
                    <Text testID="register-error" tone="danger" role="alert" aria-live="assertive">
                        {formError}
                    </Text>
                </Card>
            )}

            <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                    <TextInputField
                        testID="register-name"
                        id="register-name"
                        label={t('auth:register.nameLabel')}
                        autoComplete="name"
                        textContentType="name"
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
                name="email"
                render={({ field, fieldState }) => (
                    <TextInputField
                        testID="register-email"
                        id="register-email"
                        label={t('auth:register.emailLabel')}
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
                        testID="register-password"
                        id="register-password"
                        label={t('auth:register.passwordLabel')}
                        hint={t('auth:register.passwordHint', { count: PASSWORD_MIN_LENGTH })}
                        autoComplete="new-password"
                        textContentType="newPassword"
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
                        testID="register-password-confirmation"
                        id="register-password-confirmation"
                        label={t('auth:register.passwordConfirmationLabel')}
                        autoComplete="new-password"
                        textContentType="newPassword"
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
                name="accept_terms"
                render={({ field, fieldState }) => (
                    <Checkbox
                        testID="register-accept-terms"
                        id="register-accept-terms"
                        label={t('auth:register.acceptTerms')}
                        required
                        checked={field.value === true}
                        onChange={field.onChange}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Controller
                control={form.control}
                name="accept_privacy"
                render={({ field, fieldState }) => (
                    <Checkbox
                        testID="register-accept-privacy"
                        id="register-accept-privacy"
                        label={t('auth:register.acceptPrivacy')}
                        required
                        checked={field.value === true}
                        onChange={field.onChange}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <Button
                testID="register-submit"
                block
                label={t('auth:register.submit')}
                loading={register.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            <Inline space="xs">
                <Text tone="secondary">{t('auth:register.loginPrompt')}</Text>
                <Link testID="register-sign-in" href="/sign-in" asChild>
                    <Text tone="info" accessibilityRole="link">
                        {t('auth:register.loginLink')}
                    </Text>
                </Link>
            </Inline>
        </Stack>
    );
}
