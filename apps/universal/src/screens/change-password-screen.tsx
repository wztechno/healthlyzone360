import { Button, Card, Heading, PasswordInput, Stack, Text } from '@healthy360/design-system';
import {
    PASSWORD_MIN_LENGTH,
    makeUpdatePasswordSchema,
    toFormResolver,
} from '@healthy360/validation';
import type { UpdatePasswordValues } from '@healthy360/validation';
import { useCallback, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { toFailure, useUpdatePasswordMutation } from '../data/hooks.ts';
import { availableWorkspaceAreas } from '../navigation/items.ts';
import { useCompleteAuth, useReturnTo } from '../navigation/use-return-to.ts';
import { useAccessState } from '../session/session-provider.tsx';
import {
    applyServerFailure,
    useFailureMessage,
    useFieldErrors,
    useValidationTranslate,
} from './form-helpers.ts';

const KNOWN_FIELDS = ['current_password', 'password', 'password_confirmation'] as const;

/** Where a voluntary change returns when it was opened without a `?returnTo=`. */
const CUSTOMER_FALLBACK = '/customer/account?section=profile';
const STAFF_FALLBACK = '/profile';

export interface ChangePasswordScreenProps {
    /** The route's raw `?returnTo=`. Validated by `useReturnTo`. */
    readonly returnTo?: string | undefined;
}

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
 * bouncing back to the sign-in form.
 *
 * ## Two ways out, because two ways in
 *
 * - **Forced.** The route out is the launch resolver (`useCompleteAuth`), on a `/me` the mutation
 *   has already invalidated: the flag is now false, and the same resolver that sent them here
 *   sends them on — to the `?returnTo=` the landing carried, when there was one, else to their
 *   workspace. There is no Cancel: the change is the obligation.
 * - **By choice** (ACCOUNT-10). Opened from a settings page, so it behaves like any other detour:
 *   Cancel goes back where it came from, and Continue after success returns there too — by
 *   `dismissTo`, so the finished form is not what Back shows next. Opened bare, the fallback is the
 *   page that links here: a member of staff's profile, or a customer's account.
 *
 * Which of the two it was is fixed at submit time. The success refetches `/me`, and reading the
 * flag again on the confirmation would always say "by choice".
 */
export function ChangePasswordScreen({ returnTo }: ChangePasswordScreenProps = {}) {
    const { t } = useTranslation();
    const update = useUpdatePasswordMutation();
    const translate = useValidationTranslate();
    const describeFailure = useFailureMessage();
    const { formError, setFormError } = useFieldErrors();
    const [done, setDone] = useState<'forced' | 'voluntary' | null>(null);

    const accessState = useAccessState();
    const forced = accessState.mustChangePassword === true;
    const isStaff = availableWorkspaceAreas(accessState).some(
        (option) => option.area !== 'customer' && option.available,
    );
    const back = useReturnTo(returnTo, isStaff ? STAFF_FALLBACK : CUSTOMER_FALLBACK);
    const completeAuth = useCompleteAuth();

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
                        setDone(forced ? 'forced' : 'voluntary');
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
        [describeFailure, forced, form, setFormError, update],
    );

    if (done !== null) {
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
                        if (done === 'forced') completeAuth(back.returnTo);
                        else back.finish();
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
                        placeholder={t('auth:changePassword.currentPlaceholder')}
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
                        placeholder={t('auth:changePassword.passwordPlaceholder')}
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
                        placeholder={t('auth:changePassword.passwordConfirmationPlaceholder')}
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

            {forced ? null : (
                <Button
                    testID="change-password-cancel"
                    block
                    variant="secondary"
                    label={t('common:action.cancel')}
                    onPress={back.leave}
                />
            )}
        </Stack>
    );
}
