import type { CreateStaffAccountRequest } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Dialog,
    FormGrid,
    FormSection,
    Icon,
    IconButton,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TabItem } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useCreateStaffAccountMutation,
    useInviteStaffMutation,
    useOrganisationRolesQuery,
    useStaffSignInDomainsQuery,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { TabStepNavigation } from '../editor-steps.tsx';
import { MEMBERSHIP_INVITE_PERMISSION, USER_MANAGE_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { RoleChoiceList } from '../role-choice-list.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

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
 *
 * ## It opens the way every other kitchen record form does
 *
 * `RecordFormOpening` — title, unsaved marker, Cancel and the commit at the inline end — over
 * numbered step tabs, each an underlined section of `sm` fields in a `FormGrid`, walked with the
 * Previous / Next footer the supplier and role editors use. An invitation is two steps (sign-in,
 * role); a login made here is three (sign-in, person, role). The commit is always pressable: a
 * press over an incomplete form names what is missing in the issues banner and opens the step that
 * holds the first of it, rather than a disabled button that says nothing.
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
    'copper',
    'harvest',
    'lantern',
    'meadow',
    'saffron',
    'thistle',
    'walnut',
    'cinnamon',
    'marble',
    'olive',
    'pepper',
    'quartz',
    'ribbon',
    'summit',
    'timber',
    'velvet',
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

/** What the server accepts as a local part (`StoreStaffAccountRequest`), checked as it is typed. */
const LOCAL_PART = /^[a-z0-9]+([._-][a-z0-9]+)*$/;

type StaffStep = 'signIn' | 'person' | 'role';

/** An invitation carries no name or password — the invitee supplies both — so it has no Person. */
const INVITE_STEPS: readonly StaffStep[] = ['signIn', 'role'];
const CREATE_STEPS: readonly StaffStep[] = ['signIn', 'person', 'role'];

interface Issue {
    readonly key: string;
    readonly label: string;
    readonly fieldId: string;
    /** The step the field is drawn on, opened before the field is focused. */
    readonly step: StaffStep;
    /** A blank: named only once the commit has been pressed. Anything else is named at once. */
    readonly required: boolean;
}

function StaffCreateForm() {
    const { t } = useTranslation();
    const router = useRouter();
    const toast = useToast();

    const canInvite = useCan(MEMBERSHIP_INVITE_PERMISSION);
    const canCreate = useCan(USER_MANAGE_PERMISSION);

    const roles = useOrganisationRolesQuery();
    const domains = useStaffSignInDomainsQuery();

    const invite = useInviteStaffMutation();
    const create = useCreateStaffAccountMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    useKitchenTrailLeaf(t('accessAdmin:add.title'));

    // Whichever the caller may actually do. A person holding only one of the two codes is shown one
    // form rather than a control that refuses.
    const [mode, setMode] = useState<'invite' | 'create'>(canInvite ? 'invite' : 'create');
    const [step, setStep] = useState<StaffStep>('signIn');

    const [email, setEmail] = useState('');
    const [localPart, setLocalPart] = useState('');
    const [domain, setDomain] = useState<string | null>(null);
    const [givenName, setGivenName] = useState('');
    const [familyName, setFamilyName] = useState('');
    const [password, setPassword] = useState('');
    /*
     * A set in both modes. A login made here may hold several roles, as any membership may; an
     * invitation carries exactly one (`role_code`), so in that mode the list keeps it to one.
     */
    const [roleIds, setRoleIds] = useState<ReadonlySet<string>>(new Set());
    const [issued, setIssued] = useState<{ name: string; password: string } | null>(null);
    /** Whether the commit has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);

    /** Every field's setter goes through here, so any edit marks the form unsaved. */
    function edit<T>(set: (value: T) => void): (value: T) => void {
        return (value) => {
            set(value);
            guard.markDirty();
        };
    }

    const domainOptions = useMemo(
        () =>
            (domains.data ?? []).map((row) => ({ value: row.domain, label: row.organisationName })),
        [domains.data],
    );

    // One domain is the ordinary case and needs no picker: the field simply says what the address
    // will be. Zero means the kitchen has not opted in, and only a full address will do.
    const soleDomain = domainOptions.length === 1 ? domainOptions[0]?.value : undefined;
    const chosenDomain = domain ?? soleDomain;

    const failure = toFailure(invite.error) ?? toFailure(create.error);

    const name = [givenName.trim(), familyName.trim()].filter((part) => part !== '').join(' ');

    // The local part is the sign-in whenever there is a domain to join it to; otherwise the whole
    // address is.
    const byLocalPart = mode === 'create' && chosenDomain !== undefined;
    const trimmedLocalPart = localPart.trim();
    const localPartInvalid = trimmedLocalPart !== '' && !LOCAL_PART.test(trimmedLocalPart);

    const composed =
        !byLocalPart || trimmedLocalPart === '' || localPartInvalid
            ? null
            : `${trimmedLocalPart}@${chosenDomain}`;

    /*
     * What stops the commit, each naming the field that fixes it, in the order the steps draw
     * them. A blank waits for the press; a sign-in name the server would refuse is named at once.
     */
    const required = (key: string, label: string, fieldId: string, on: StaffStep): Issue => ({
        key,
        label,
        fieldId,
        step: on,
        required: true,
    });
    const issues: readonly Issue[] = [
        ...(byLocalPart
            ? trimmedLocalPart === '' || localPartInvalid
                ? [
                      {
                          key: 'local-part',
                          label: t('accessAdmin:add.signInName'),
                          fieldId: 'kitchen-staff-create-local-part',
                          step: 'signIn' as const,
                          required: !localPartInvalid,
                      },
                  ]
                : []
            : email.trim() === ''
              ? [
                    required(
                        'email',
                        t('accessAdmin:add.email'),
                        'kitchen-staff-create-email',
                        'signIn',
                    ),
                ]
              : []),
        ...(mode === 'create' && password.trim() === ''
            ? [
                  required(
                      'password',
                      t('accessAdmin:add.password'),
                      'kitchen-staff-create-password',
                      'signIn',
                  ),
              ]
            : []),
        ...(mode === 'create' && givenName.trim() === ''
            ? [
                  required(
                      'given-name',
                      t('accessAdmin:add.givenName'),
                      'kitchen-staff-create-given-name',
                      'person',
                  ),
              ]
            : []),
        ...(mode === 'create' && familyName.trim() === ''
            ? [
                  required(
                      'family-name',
                      t('accessAdmin:add.familyName'),
                      'kitchen-staff-create-family-name',
                      'person',
                  ),
              ]
            : []),
        // An invitation is an offer of a role; a login made here may be given one later.
        ...(mode === 'invite' && roleIds.size === 0
            ? [required('role', t('accessAdmin:add.role'), 'kitchen-staff-create-role', 'role')]
            : []),
    ];
    const shownIssues = attempted ? issues : issues.filter((issue) => !issue.required);
    const errorFor = (key: string): { readonly error?: string } => {
        const issue = shownIssues.find((candidate) => candidate.key === key);
        if (issue === undefined) return {};
        return {
            error: issue.required
                ? t('kitchen:forms.required')
                : t('accessAdmin:add.signInNameInvalid'),
        };
    };

    function goToIssue(issue: Issue) {
        setStep(issue.step);
        focusField(issue.fieldId);
    }

    function submit() {
        if (mode === 'invite') {
            const role = (roles.data ?? []).find((candidate) => roleIds.has(String(candidate.id)));
            if (role === undefined) return;

            invite.mutate(
                { email: email.trim(), roleCode: role.code },
                {
                    onSuccess: () => {
                        guard.markClean();
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
            ...(byLocalPart ? { localPart: trimmedLocalPart } : { email: email.trim() }),
            givenName: givenName.trim(),
            familyName: familyName.trim(),
            password,
            roleIds: [...roleIds],
        };

        create.mutate(request, {
            onSuccess: (result) => {
                guard.markClean();
                setIssued({ name, password: result.initialPassword });
            },
        });
    }

    /*
     * Always pressable. The press marks the form attempted and opens the step holding the first
     * thing that stops it; only a complete form reaches the server.
     */
    function attemptSubmit() {
        setAttempted(true);
        const first = issues[0];
        if (first !== undefined) {
            goToIssue(first);
            return;
        }
        submit();
    }

    const stepLabels: Readonly<Record<StaffStep, string>> = {
        signIn: t(
            mode === 'invite'
                ? 'accessAdmin:add.sections.invitation'
                : 'accessAdmin:add.sections.signIn',
        ),
        person: t('accessAdmin:add.sections.person'),
        role: t(mode === 'invite' ? 'accessAdmin:add.role' : 'accessAdmin:add.roles'),
    };

    const stepItems: readonly TabItem<StaffStep>[] = (
        mode === 'invite' ? INVITE_STEPS : CREATE_STEPS
    ).map((key) => {
        const count = shownIssues.filter((issue) => issue.step === key).length;
        return {
            value: key,
            label: stepLabels[key],
            ...(count > 0
                ? {
                      issues: {
                          count,
                          tone: 'danger' as const,
                          label: t('kitchen:forms.toFixCount', { count }),
                      },
                  }
                : {}),
            testID: `kitchen-staff-create-tabs-tab-${key}`,
        };
    });

    return (
        <>
            <Stack space="md" testID="kitchen-staff-create-screen">
                <RecordFormOpening<StaffStep>
                    testID="kitchen-staff-create"
                    title={t('accessAdmin:add.title')}
                    dirty={guard.isDirty}
                    actions={
                        <>
                            <Button
                                testID="kitchen-staff-create-cancel"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(() => {
                                        router.back();
                                    });
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
                                disabled={invite.isPending || create.isPending}
                                onPress={attemptSubmit}
                            />
                        </>
                    }
                    errors={{
                        summary: t(
                            shownIssues.every((issue) => issue.required)
                                ? 'kitchen:forms.requiredCount'
                                : 'kitchen:forms.toFixCount',
                            { count: shownIssues.length },
                        ),
                        items: shownIssues.map((issue) => ({
                            key: issue.key,
                            label: issue.label,
                            onPress: () => {
                                goToIssue(issue);
                            },
                        })),
                    }}
                    steps={{
                        label: t('kitchen:editor.stepsLabel'),
                        items: stepItems,
                        value: step,
                        onChange: setStep,
                    }}
                />

                {failure === null ? null : (
                    <Callout
                        testID="kitchen-staff-create-error"
                        tone="danger"
                        role="alert"
                        title={failure.message}
                    />
                )}

                {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
                <View className="z-auto flex-col">
                    {step !== 'signIn' ? null : (
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-staff-create-access"
                            title={stepLabels.signIn}
                            description={t(
                                mode === 'invite'
                                    ? 'accessAdmin:add.inviteHint'
                                    : 'accessAdmin:add.createHint',
                            )}
                            actions={
                                canInvite && canCreate ? (
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
                                        onChange={(next) => {
                                            setMode(next);
                                            // An invitation carries one role: several chosen for a
                                            // login are not narrowed to an arbitrary one of them.
                                            if (next === 'invite' && roleIds.size > 1) {
                                                setRoleIds(new Set());
                                            }
                                            // A different form: what the last one was missing is
                                            // not what this one is.
                                            setAttempted(false);
                                        }}
                                    />
                                ) : null
                            }
                        >
                            <FormGrid testID="kitchen-staff-create-access-grid">
                                {byLocalPart ? (
                                    <TextInputField
                                        testID="kitchen-staff-create-local-part"
                                        id="kitchen-staff-create-local-part"
                                        label={t('accessAdmin:add.signInName')}
                                        placeholder={t('accessAdmin:add.placeholders.signInName')}
                                        size="sm"
                                        autoCapitalize="none"
                                        value={localPart}
                                        required
                                        onChangeText={edit(setLocalPart)}
                                        // The domain sits inside the frame, beside the name it
                                        // completes.
                                        trailing={
                                            domainOptions.length > 1 ? undefined : (
                                                <Text
                                                    testID="kitchen-staff-create-domain-fixed"
                                                    variant="caption"
                                                    tone="secondary"
                                                >
                                                    {`@${chosenDomain ?? ''}`}
                                                </Text>
                                            )
                                        }
                                        {...(composed === null
                                            ? {}
                                            : {
                                                  hint: t('accessAdmin:add.signInNameHint', {
                                                      example: composed,
                                                  }),
                                              })}
                                        {...errorFor('local-part')}
                                    />
                                ) : (
                                    <TextInputField
                                        testID="kitchen-staff-create-email"
                                        id="kitchen-staff-create-email"
                                        label={t('accessAdmin:add.email')}
                                        placeholder={t('accessAdmin:add.placeholders.email')}
                                        size="sm"
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        value={email}
                                        required
                                        onChangeText={edit(setEmail)}
                                        {...errorFor('email')}
                                    />
                                )}

                                {byLocalPart && domainOptions.length > 1 ? (
                                    <Select
                                        testID="kitchen-staff-create-domain"
                                        label={t('accessAdmin:add.domain')}
                                        options={domainOptions}
                                        value={chosenDomain ?? null}
                                        onChange={edit(setDomain)}
                                    />
                                ) : null}

                                {mode === 'create' ? (
                                    <TextInputField
                                        testID="kitchen-staff-create-password"
                                        id="kitchen-staff-create-password"
                                        label={t('accessAdmin:add.password')}
                                        placeholder={t('accessAdmin:add.placeholders.password')}
                                        size="sm"
                                        autoCapitalize="none"
                                        value={password}
                                        required
                                        onChangeText={edit(setPassword)}
                                        trailing={
                                            <IconButton
                                                testID="kitchen-staff-create-generate"
                                                size="sm"
                                                variant="ghost"
                                                label={t('accessAdmin:add.generate')}
                                                icon={<Icon name="refresh" size="sm" />}
                                                onPress={() => {
                                                    setPassword(generatePassphrase());
                                                    guard.markDirty();
                                                }}
                                            />
                                        }
                                        {...errorFor('password')}
                                    />
                                ) : null}
                            </FormGrid>
                        </FormSection>
                    )}

                    {step !== 'person' || mode !== 'create' ? null : (
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-staff-create-person"
                            title={stepLabels.person}
                        >
                            <FormGrid testID="kitchen-staff-create-person-grid">
                                <TextInputField
                                    testID="kitchen-staff-create-given-name"
                                    id="kitchen-staff-create-given-name"
                                    label={t('accessAdmin:add.givenName')}
                                    placeholder={t('accessAdmin:add.placeholders.givenName')}
                                    size="sm"
                                    value={givenName}
                                    required
                                    onChangeText={edit(setGivenName)}
                                    {...errorFor('given-name')}
                                />
                                <TextInputField
                                    testID="kitchen-staff-create-family-name"
                                    id="kitchen-staff-create-family-name"
                                    label={t('accessAdmin:add.familyName')}
                                    placeholder={t('accessAdmin:add.placeholders.familyName')}
                                    size="sm"
                                    value={familyName}
                                    required
                                    onChangeText={edit(setFamilyName)}
                                    {...errorFor('family-name')}
                                />
                            </FormGrid>
                        </FormSection>
                    )}

                    {step !== 'role' ? null : (
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-staff-create-role-section"
                            title={stepLabels.role}
                        >
                            <Stack space="sm">
                                <Text variant="caption" tone="secondary">
                                    {t(
                                        mode === 'invite'
                                            ? 'accessAdmin:add.roleInviteHint'
                                            : 'accessAdmin:add.rolesCreateHint',
                                    )}
                                </Text>
                                <RoleChoiceList
                                    testID="kitchen-staff-create-role"
                                    itemTestID="kitchen-staff-create-role"
                                    id="kitchen-staff-create-role"
                                    label={stepLabels.role}
                                    roles={roles.data ?? []}
                                    mode={mode === 'invite' ? 'single' : 'multiple'}
                                    selected={roleIds}
                                    onChange={edit(setRoleIds)}
                                    {...errorFor('role')}
                                />
                            </Stack>
                        </FormSection>
                    )}
                </View>

                <TabStepNavigation<StaffStep>
                    testID="kitchen-staff-create-steps-nav"
                    items={stepItems}
                    value={step}
                    onChange={setStep}
                />
            </Stack>

            <EditorGuardDialogs testID="kitchen-staff-create" guard={guard} />

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
