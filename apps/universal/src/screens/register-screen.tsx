import { PASSWORD_MIN_LENGTH, makeRegisterSchema, toFormResolver } from '@healthy360/validation';
import type { RegisterInput, RegisterValues } from '@healthy360/validation';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { toFailure, useRegisterMutation } from '../data/hooks.ts';
import { safeReturnTo, withReturnTo } from '../navigation/return-to.ts';
import { useKeepBrowsing } from '../navigation/use-keep-browsing.ts';
import {
    AuthCheck,
    AuthError,
    AuthField,
    AuthHint,
    AuthLink,
    AuthSubmit,
    AuthTabs,
    AuthTitle,
} from '../ui/auth-form.tsx';
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

export interface RegisterScreenProps {
    /** The route's raw `?returnTo=`. Validated here; an unsafe value is ignored. */
    readonly returnTo?: string | undefined;
}

/**
 * Registration, drawn as the accepted Create-account board in the sign-in frame: the Sign in / Create
 * account tabs with the pill on Create account, the name, the email, the password beside its
 * confirmation, the two consent boxes and the Create account pill.
 *
 * The schema is `@healthy360/validation`'s, translated at render time, so the client mirrors the
 * server's password policy without keeping a second copy of it. The two consents are booleans
 * refined to `true`: an unticked box fails validation rather than quietly submitting `false`, and
 * unlike a `z.literal(true)` the unchecked initial state is still expressible.
 *
 * ## The return rides on to verification
 *
 * A new account is not finished until its email address is confirmed, so success replaces this
 * entry with `/verify-email` carrying `?returnTo=`, and *that* screen's Continue finishes the trip.
 * "Sign in" replaces rather than pushes, with the same return, and "Keep browsing" leaves the way
 * the sign-in screen's does.
 */
export function RegisterScreen({ returnTo: rawReturnTo }: RegisterScreenProps = {}) {
    const { t } = useTranslation();
    const router = useRouter();
    const register = useRegisterMutation();
    const { formError, setFormError } = useFieldErrors();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const returnTo = safeReturnTo(rawReturnTo);
    const keepBrowsing = useKeepBrowsing(returnTo);

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
                        router.replace(withReturnTo('/verify-email', returnTo) as never);
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
        [describeFailure, form, register, returnTo, router, setFormError],
    );

    const toSignIn = () => {
        router.replace(withReturnTo('/sign-in', returnTo) as never);
    };

    return (
        <View testID="register-screen" className="flex-col gap-3.5">
            <AuthTabs
                value="up"
                label={t('auth:frame.tabsLabel')}
                signInLabel={t('auth:login.title')}
                createLabel={t('auth:register.submit')}
                onSignIn={toSignIn}
                onCreate={() => undefined}
            />

            <View className="mt-3">
                <AuthTitle testID="register-title">{t('auth:register.title')}</AuthTitle>
            </View>

            {formError === null ? null : <AuthError testID="register-error" message={formError} />}

            <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                    <AuthField
                        testID="register-name"
                        label={t('auth:register.nameLabel')}
                        icon="user"
                        placeholder={t('auth:register.namePlaceholder')}
                        autoComplete="name"
                        textContentType="name"
                        autoCapitalize="words"
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
                    <AuthField
                        testID="register-email"
                        label={t('auth:register.emailLabel')}
                        icon="send"
                        placeholder={t('auth:login.emailPlaceholder')}
                        keyboardType="email-address"
                        autoComplete="email"
                        textContentType="emailAddress"
                        value={field.value}
                        onChangeText={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <View className="flex-col gap-3.5 sm:flex-row sm:gap-3">
                <View className="min-w-0 sm:flex-1">
                    <Controller
                        control={form.control}
                        name="password"
                        render={({ field, fieldState }) => (
                            <AuthField
                                testID="register-password"
                                label={t('auth:register.passwordLabel')}
                                icon="lock"
                                placeholder={t('auth:register.passwordPlaceholder')}
                                autoComplete="new-password"
                                textContentType="newPassword"
                                secret
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                                error={fieldState.error?.message}
                            />
                        )}
                    />
                </View>
                <View className="min-w-0 sm:flex-1">
                    <Controller
                        control={form.control}
                        name="password_confirmation"
                        render={({ field, fieldState }) => (
                            <AuthField
                                testID="register-password-confirmation"
                                label={t('auth:register.passwordConfirmationLabel')}
                                icon="lock"
                                placeholder={t('auth:register.passwordConfirmationPlaceholder')}
                                autoComplete="new-password"
                                textContentType="newPassword"
                                secret
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                                error={fieldState.error?.message}
                            />
                        )}
                    />
                </View>
            </View>

            <AuthHint>{t('auth:register.passwordHint', { count: PASSWORD_MIN_LENGTH })}</AuthHint>

            <Controller
                control={form.control}
                name="accept_terms"
                render={({ field, fieldState }) => (
                    <AuthCheck
                        testID="register-accept-terms"
                        label={t('auth:register.acceptTerms')}
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
                    <AuthCheck
                        testID="register-accept-privacy"
                        label={t('auth:register.acceptPrivacy')}
                        checked={field.value === true}
                        onChange={field.onChange}
                        error={fieldState.error?.message}
                    />
                )}
            />

            <AuthSubmit
                testID="register-submit"
                label={t('auth:register.submit')}
                busy={register.isPending}
                onPress={() => {
                    void form.handleSubmit(onSubmit)();
                }}
            />

            <View className="mt-4 flex-row flex-wrap items-center justify-center gap-x-1">
                <RNText className="text-sm font-medium text-content-secondary">
                    {t('auth:register.loginPrompt')}
                </RNText>
                <RNText
                    testID="register-sign-in"
                    role="link"
                    accessibilityRole="link"
                    onPress={toSignIn}
                    className="py-3 text-sm font-semibold text-content-on-brand-subtle hover:underline"
                >
                    {t('auth:register.loginLink')}
                </RNText>
            </View>

            <AuthLink
                testID="register-keep-browsing"
                label={t('common:action.keepBrowsing')}
                onPress={keepBrowsing}
            />
        </View>
    );
}
