import type { CreateStaffAccountRequest } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Dialog,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useCreateStaffAccountMutation,
    useInviteStaffMutation,
    useOrganisationRolesQuery,
    useStaffSignInDomainsQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { MEMBERSHIP_INVITE_PERMISSION, USER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { KitchenPageHeader } from '../kitchen-page-header.tsx';

/**
 * `/kitchen/team/new` — letting somebody in, two ways (AA1).
 *
 * ## Invitation first, and that ordering is the recommendation
 *
 * A colleague with a mailbox should be invited: they choose a password nobody else ever knows, and
 * nothing about their account is ever held by their employer. Direct creation exists for the kitchen
 * hand who has no mailbox, and whose alternative is no account at all — so it is the second segment,
 * and its hint says what it costs rather than only what it does.
 *
 * ## The sign-in name is the whole point of the second form
 *
 * A person who has no work email address is asked for a local part and nothing else; the kitchen's
 * own domain supplies the rest. What reaches the server is an ordinary address, so Fortify, Sanctum,
 * the token endpoint and password reset are all untouched — the alternative was a `username` column
 * and a branch in every one of them.
 *
 * The domain picker is rendered only when the kitchen has more than one to choose from, which today
 * is never. With one, the field says what the address will be and composes it silently; with none,
 * only a full address is accepted and the form says so.
 *
 * ## The password is shown once, behind something that cannot be dismissed by accident
 *
 * The API returns it in the create response and on no read, so a screen that discards it cannot ask
 * again. The dialog is the one place it exists, and it closes on an explicit acknowledgement rather
 * than on a backdrop tap.
 */

export function StaffCreateScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ anyOf: [MEMBERSHIP_INVITE_PERMISSION, USER_MANAGE_PERMISSION] }}
            testID="kitchen-staff-create"
        >
            <StaffCreateForm />
        </Gate>
    );
}

/**
 * A password somebody will read aloud once and type once.
 *
 * Four short words from a small list rather than a random string: it survives being read down a
 * noisy kitchen and typed on a phone, which a sixteen-character mixed-case string does not. It is
 * replaced at first sign-in in any case — `must_change_password` is set by the endpoint — so its job
 * is to be transcribable, not to be a lasting secret.
 */
const PASSWORD_WORDS = [
    'copper', 'harvest', 'lantern', 'meadow', 'saffron', 'thistle', 'walnut', 'cinnamon',
    'marble', 'olive', 'pepper', 'quartz', 'ribbon', 'summit', 'timber', 'velvet',
];

export function generatePassphrase(): string {
    const picked: string[] = [];
    const bytes = new Uint32Array(4);
    crypto.getRandomValues(bytes);

    for (const value of bytes) {
        picked.push(PASSWORD_WORDS[value % PASSWORD_WORDS.length] ?? 'olive');
    }

    return picked.join('-');
}

function StaffCreateForm() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();

    const canInvite = useCan(MEMBERSHIP_INVITE_PERMISSION);
    const canCreate = useCan(USER_MANAGE_PERMISSION);

    const roles = useOrganisationRolesQuery();
    const domains = useStaffSignInDomainsQuery();

    const invite = useInviteStaffMutation();
    const create = useCreateStaffAccountMutation();

    // Whichever the caller may actually do. A person holding only one of the two codes is shown one
    // form rather than a control that refuses.
    const [mode, setMode] = useState<'invite' | 'create'>(canInvite ? 'invite' : 'create');

    const [email, setEmail] = useState('');
    const [localPart, setLocalPart] = useState('');
    const [domain, setDomain] = useState<string | null>(null);
    const [givenName, setGivenName] = useState('');
    const [familyName, setFamilyName] = useState('');
    const [password, setPassword] = useState('');
    const [roleId, setRoleId] = useState<string | null>(null);
    const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);

    const domainOptions = useMemo(
        () => (domains.data ?? []).map((row) => ({ value: row.domain, label: row.organisationName })),
        [domains.data],
    );

    // One domain is the ordinary case and needs no picker: the field simply says what the address
    // will be. Zero means the kitchen has not opted in, and only a full address will do.
    const soleDomain = domainOptions.length === 1 ? domainOptions[0]?.value : undefined;
    const chosenDomain = domain ?? soleDomain;

    const roleOptions = useMemo(
        () =>
            (roles.data ?? []).map((role) => ({
                value: String(role.id),
                label: locale.startsWith('ar') ? role.nameAr : role.nameEn,
            })),
        [roles.data, locale],
    );

    const failure = toFailure(invite.error) ?? toFailure(create.error);

    const name = [givenName, familyName].filter((part) => part !== '').join(' ');

    function submit() {
        if (mode === 'invite') {
            const role = (roles.data ?? []).find((candidate) => String(candidate.id) === roleId);
            if (role === undefined) return;

            invite.mutate(
                { email, roleCode: role.code },
                {
                    onSuccess: () => {
                        toast.show({ message: t('accessAdmin:team.invitations.sent', { email }) });
                        router.back();
                    },
                },
            );
            return;
        }

        const request: CreateStaffAccountRequest = {
            // Exactly one of the two. A body carrying both is refused by the server, so the form
            // sends whichever the person actually filled in.
            ...(chosenDomain === undefined || localPart.trim() === ''
                ? { email }
                : { localPart: localPart.trim() }),
            givenName,
            familyName,
            password,
            roleIds: roleId === null ? [] : [roleId],
        };

        create.mutate(request, {
            onSuccess: (result) => {
                setIssued({ name, password: result.initialPassword });
            },
        });
    }

    const composed =
        chosenDomain === undefined || localPart.trim() === ''
            ? null
            : `${localPart.trim()}@${chosenDomain}`;

    return (
        <>
            <Stack space="lg" testID="kitchen-staff-create-screen">
                <KitchenPageHeader
                    testID="kitchen-staff-create-header"
                    title={t('accessAdmin:add.title')}
                    subtitle={t(
                        mode === 'invite' ? 'accessAdmin:add.inviteHint' : 'accessAdmin:add.createHint',
                    )}
                    titleTestID="kitchen-staff-create-title"
                    subtitleTestID="kitchen-staff-create-subtitle"
                />

                {canInvite && canCreate ? (
                    <SegmentedControl<'invite' | 'create'>
                        testID="kitchen-staff-create-mode"
                        label={t('accessAdmin:add.title')}
                        items={[
                            {
                                value: 'invite',
                                label: t('accessAdmin:add.modes.invite'),
                                testID: 'kitchen-staff-create-mode-option-invite',
                            },
                            {
                                value: 'create',
                                label: t('accessAdmin:add.modes.create'),
                                testID: 'kitchen-staff-create-mode-option-create',
                            },
                        ]}
                        value={mode}
                        onChange={setMode}
                    />
                ) : null}

                {failure === null ? null : (
                    <Callout
                        testID="kitchen-staff-create-error"
                        tone="danger"
                        role="alert"
                        title={failure.message}
                    />
                )}

                <Card padding="md">
                    <Stack space="md">
                        {mode === 'invite' || chosenDomain === undefined ? (
                            <TextInputField
                                testID="kitchen-staff-create-email"
                                label={t('accessAdmin:add.email')}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                value={email}
                                required
                                onChangeText={setEmail}
                            />
                        ) : (
                            <Stack space="xs">
                                <Inline space="sm" align="end" wrap>
                                    <TextInputField
                                        testID="kitchen-staff-create-local-part"
                                        label={t('accessAdmin:add.signInName')}
                                        autoCapitalize="none"
                                        value={localPart}
                                        required
                                        onChangeText={setLocalPart}
                                    />
                                    {domainOptions.length > 1 ? (
                                        <Select
                                            testID="kitchen-staff-create-domain"
                                            label={t('accessAdmin:add.domain')}
                                            options={domainOptions}
                                            value={chosenDomain ?? null}
                                            onChange={setDomain}
                                        />
                                    ) : (
                                        <Text
                                            testID="kitchen-staff-create-domain-fixed"
                                            tone="secondary"
                                        >
                                            {`@${chosenDomain}`}
                                        </Text>
                                    )}
                                </Inline>
                                {composed === null ? null : (
                                    <Text
                                        variant="caption"
                                        tone="secondary"
                                        testID="kitchen-staff-create-composed"
                                    >
                                        {t('accessAdmin:add.signInNameHint', { example: composed })}
                                    </Text>
                                )}
                            </Stack>
                        )}

                        {mode === 'create' ? (
                            <>
                                <TextInputField
                                    testID="kitchen-staff-create-given-name"
                                    label={t('accessAdmin:add.givenName')}
                                    value={givenName}
                                    required
                                    onChangeText={setGivenName}
                                />
                                <TextInputField
                                    testID="kitchen-staff-create-family-name"
                                    label={t('accessAdmin:add.familyName')}
                                    value={familyName}
                                    required
                                    onChangeText={setFamilyName}
                                />
                                <Stack space="xs">
                                    <TextInputField
                                        testID="kitchen-staff-create-password"
                                        label={t('accessAdmin:add.password')}
                                        hint={t('accessAdmin:add.passwordHint')}
                                        autoCapitalize="none"
                                        value={password}
                                        required
                                        onChangeText={setPassword}
                                    />
                                    <Inline space="sm" justify="end">
                                        <Button
                                            testID="kitchen-staff-create-generate"
                                            size="sm"
                                            variant="secondary"
                                            label={t('accessAdmin:add.generate')}
                                            onPress={() => {
                                                setPassword(generatePassphrase());
                                            }}
                                        />
                                    </Inline>
                                </Stack>
                            </>
                        ) : null}

                        <Select
                            testID="kitchen-staff-create-role"
                            label={t('accessAdmin:add.role')}
                            options={roleOptions}
                            value={roleId}
                            required={mode === 'invite'}
                            onChange={setRoleId}
                        />
                    </Stack>
                </Card>

                <Inline space="sm" justify="end" wrap>
                    <Button
                        testID="kitchen-staff-create-cancel"
                        variant="secondary"
                        label={t('accessAdmin:member.cancel')}
                        onPress={() => {
                            router.back();
                        }}
                    />
                    <Button
                        testID="kitchen-staff-create-submit"
                        label={t(
                            mode === 'invite'
                                ? 'accessAdmin:add.submitInvite'
                                : 'accessAdmin:add.submitCreate',
                        )}
                        loading={invite.isPending || create.isPending}
                        disabled={
                            mode === 'invite'
                                ? email.trim() === '' || roleId === null
                                : givenName.trim() === '' ||
                                  password.trim() === '' ||
                                  (composed === null && email.trim() === '')
                        }
                        onPress={submit}
                    />
                </Inline>

            </Stack>

            <Dialog
                testID="kitchen-staff-create-password-dialog"
                open={issued !== null}
                // No backdrop dismissal: this is the only time the password exists, and losing it to
                // a stray tap means the account cannot be handed over.
                dismissOnBackdrop={false}
                onClose={() => {
                    setIssued(null);
                    router.back();
                }}
                title={t('accessAdmin:add.passwordTitle')}
                description={t('accessAdmin:add.passwordBody', { name: issued?.name ?? '' })}
                actions={
                    <Button
                        testID="kitchen-staff-create-password-acknowledge"
                        label={t('accessAdmin:add.passwordAcknowledge')}
                        onPress={() => {
                            const created = issued;
                            setIssued(null);
                            if (created !== null) {
                                toast.show({
                                    message: t('accessAdmin:add.created', { name: created.name }),
                                });
                            }
                            router.back();
                        }}
                    />
                }
            >
                <Text variant="bodyStrong" testID="kitchen-staff-create-password-value">
                    {issued?.password ?? ''}
                </Text>
            </Dialog>
        </>
    );
}
