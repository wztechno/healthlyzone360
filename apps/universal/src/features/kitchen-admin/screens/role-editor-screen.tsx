import { apiFailure, isDeletableRole } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    ErrorState,
    FormGrid,
    FormSection,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { TabItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useCreateRoleMutation,
    useDeleteRoleMutation,
    useOrganisationRoleQuery,
    usePermissionCatalogueQuery,
    useUpdateRoleMutation,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { TabStepNavigation } from '../editor-steps.tsx';
import { ROLE_MANAGE_PERMISSION, ROLE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { toSavedCodes } from '../page-permissions.ts';
import { EditorGuardDialogs, RecordFormOpening } from '../record-form-opening.tsx';
import { RolePagesTab } from '../role-pages-tab.tsx';
import { RolePermissionsTab } from '../role-permissions-tab.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/roles/{role}` and `/kitchen/roles/new` — one editor, three jobs.
 *
 * It creates a role, edits one, and reads a platform template it cannot change. They are one screen
 * because they are one form: the difference between them is which fields are writable and which
 * button appears, not which controls exist.
 *
 * ## It opens the way every other kitchen record form does
 *
 * `RecordFormOpening` — title, reference, unsaved marker, then Cancel and Delete at the inline end —
 * over three numbered steps: the role's own details, then Pages, then Advanced, walked with the same
 * Previous / Next footer the supplier and plan editors use. On the last step Next becomes Save role.
 * It is always pressable over an incomplete role: the press names what is missing and takes the
 * reader to it.
 *
 * ## Copy is a create seeded from a read
 *
 * `/kitchen/roles/new?from={role}` fetches the source and pre-fills from it. That is the only
 * supported way to change what a platform template means inside a kitchen — acceptance prefers a
 * tenant's own role of the same code — so the code field is left editable and pre-filled with the
 * source's, and the form warns if it is kept rather than refusing it.
 *
 * ## Pages and Advanced write the same state
 *
 * Both edit one `Set` of codes held here. Pages owns only the codes the registry names, so a save
 * made entirely on that step keeps the publish codes and the own-scope six — the invariant
 * `page-permissions.ts` states and its test pins. Advanced can reach everything. Switching between
 * them mid-edit loses nothing, because there is nothing to lose: one set, two views of it.
 *
 * ## A template is read-only and says so once
 *
 * Save is not drawn, every field is disabled and a callout explains why and what to do instead.
 * Refusing on submit would be the same rule stated at the worst possible moment.
 */

export function RoleEditorScreen() {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ROLE_VIEW_PERMISSION] }}
            testID="kitchen-role-editor"
        >
            <RoleEditor />
        </Gate>
    );
}

type RoleStep = 'details' | 'pages' | 'advanced';

const ROLE_STEPS: readonly RoleStep[] = ['details', 'pages', 'advanced'];

/** What the server accepts as a role's reference (`StoreOrganisationRoleRequest`). */
const ROLE_CODE = /^[a-z][a-z0-9_]*$/;

interface Draft {
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly descriptionEn: string;
    readonly descriptionAr: string;
    readonly codes: ReadonlySet<string>;
}

interface Issue {
    readonly key: string;
    readonly label: string;
    readonly fieldId: string;
    /** A blank: named only once Save has been pressed. A malformed reference is named at once. */
    readonly required: boolean;
}

function RoleEditor() {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();

    const params = useLocalSearchParams<{ readonly role?: string; readonly from?: string }>();

    // `/roles/new` has no `role`; `?from=` names the role to copy. Both are reads of the same
    // endpoint, which is why one query serves all three jobs.
    const isNew = params.role === undefined || params.role === 'new';
    const sourceId = isNew ? params.from : params.role;

    const canManage = useCan(ROLE_MANAGE_PERMISSION);

    const source = useOrganisationRoleQuery(sourceId);
    const catalogue = usePermissionCatalogueQuery();

    const create = useCreateRoleMutation();
    const update = useUpdateRoleMutation();
    const remove = useDeleteRoleMutation();

    const [draft, setDraft] = useState<Draft | null>(null);
    const [step, setStep] = useState<RoleStep>('details');
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);

    const guard = useUnsavedGuard({ message: t('kitchen:editor.unsavedMessage') });

    const record = source.data;
    const isTemplate = !isNew && record?.isSystem === true;
    const readOnly = isTemplate || !canManage;

    const title = isNew
        ? record === undefined
            ? t('accessAdmin:role.newTitle')
            : t('accessAdmin:role.copyTitle', {
                  name: locale.startsWith('ar') ? record.nameAr : record.nameEn,
              })
        : record === undefined
          ? ''
          : locale.startsWith('ar')
            ? (draft?.nameAr ?? record.nameAr)
            : (draft?.nameEn ?? record.nameEn);

    // The top bar's trail names the role too, once there is a name to give it.
    useKitchenTrailLeaf(title === '' ? null : title);

    // Null until the person edits: while the form is clean the fetched record is the truth, so a
    // refetch is reflected rather than overwritten by stale local state.
    const current: Draft = useMemo(() => {
        if (draft !== null) return draft;

        if (record === undefined) {
            return {
                code: '',
                nameEn: '',
                nameAr: '',
                descriptionEn: '',
                descriptionAr: '',
                codes: new Set(),
            };
        }

        return {
            // A copy keeps the source's code, because taking a template's code is how a fork
            // replaces it. The form warns; it does not refuse.
            code: record.code,
            nameEn: record.nameEn,
            nameAr: record.nameAr,
            descriptionEn: record.descriptionEn ?? '',
            descriptionAr: record.descriptionAr ?? '',
            codes: new Set(record.permissions),
        };
    }, [draft, record]);

    /**
     * The conflict dialog, wired to `update` alone.
     *
     * **`create` and `remove` are deliberately left out, and `remove` is the one that matters.**
     * `capture()` fires on any `resource.conflict`, and a delete refused because six people still
     * hold the role is a `resource.conflict` that is *not* a lost race — swallowing it would offer
     * "somebody else saved, reload?" for "six people hold this". That refusal keeps the banner,
     * which already names the count. `create` has no version to lose in the first place.
     */
    const concurrency = useOptimisticConcurrency({
        onReload: () => {
            setDraft(null);
            guard.markClean();
            void source.refetch();
        },
    });

    function edit(patch: Partial<Draft>) {
        setDraft({ ...current, ...patch });
        guard.markDirty();
    }

    const loading = (sourceId !== undefined && source.isPending) || catalogue.isPending;
    const failure = toFailure(source.error) ?? toFailure(catalogue.error);
    // The lost-race conflict belongs to the dialog once it has been captured; leaving it in the
    // banner too would say the same thing twice, in two voices, one of which offers no way out.
    const captured = concurrency.conflict !== null;
    const writeFailure = captured
        ? null
        : (toFailure(create.error) ?? toFailure(update.error) ?? toFailure(remove.error));

    if (loading) {
        return (
            <Stack space="md" testID="kitchen-role-editor-loading">
                <Skeleton testID="kitchen-role-editor-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-role-editor-skeleton-2" heightClassName="h-10" />
                <Skeleton testID="kitchen-role-editor-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    if (failure !== null) {
        return (
            <ErrorState
                testID="kitchen-role-editor-error"
                failure={failure}
                onRetry={() => {
                    void source.refetch();
                    void catalogue.refetch();
                }}
                retrying={source.isFetching}
            />
        );
    }

    if (!isNew && record === undefined) {
        return (
            <ErrorState
                testID="kitchen-role-editor-missing"
                failure={apiFailure('resource.not_found')}
            />
        );
    }

    /*
     * What stops the save, each naming the field that fixes it, in the order the details step
     * draws them. Every one lives on that step. The reference is fixed once the role exists, so it
     * is only checked on a create.
     */
    const code = current.code.trim();
    const nameLabel = t('accessAdmin:role.name');
    const issues: readonly Issue[] = [
        ...(isNew && (code === '' || !ROLE_CODE.test(code))
            ? [
                  {
                      key: 'code',
                      label: t('accessAdmin:role.code'),
                      fieldId: 'kitchen-role-editor-code',
                      required: code === '',
                  },
              ]
            : []),
        ...(current.nameEn.trim() === ''
            ? [
                  {
                      key: 'name-en',
                      label: t('kitchen:bilingual.englishShort', { field: nameLabel }),
                      fieldId: 'kitchen-role-editor-name-en',
                      required: true,
                  },
              ]
            : []),
        // The endpoint refuses a role without one, so unlike a catalogue name it is not deferred to
        // a later gate: there is no later gate for a role.
        ...(current.nameAr.trim() === ''
            ? [
                  {
                      key: 'name-ar',
                      label: t('kitchen:bilingual.arabicShort', { field: nameLabel }),
                      fieldId: 'kitchen-role-editor-name-ar',
                      required: true,
                  },
              ]
            : []),
    ];
    const shownIssues = readOnly
        ? []
        : attempted
          ? issues
          : issues.filter((issue) => !issue.required);
    const shows = (key: string): boolean => shownIssues.some((issue) => issue.key === key);

    function save() {
        const permissions = toSavedCodes(current.codes);
        const body = {
            nameEn: current.nameEn.trim(),
            nameAr: current.nameAr.trim(),
            descriptionEn:
                current.descriptionEn.trim() === '' ? null : current.descriptionEn.trim(),
            descriptionAr:
                current.descriptionAr.trim() === '' ? null : current.descriptionAr.trim(),
            permissions,
        };

        if (isNew) {
            create.mutate(
                { ...body, code },
                {
                    onSuccess: (result) => {
                        guard.markClean();
                        toast.show({
                            message: t('accessAdmin:role.created', {
                                name: locale.startsWith('ar')
                                    ? result.role.nameAr
                                    : result.role.nameEn,
                            }),
                        });
                        router.replace(`/kitchen/roles/${String(result.role.id)}` as never);
                    },
                },
            );
            return;
        }

        if (record === undefined) return;

        update.mutate(
            { ...body, role: String(record.id), lockVersion: record.lockVersion },
            {
                onSuccess: () => {
                    guard.markClean();
                    setDraft(null);
                    setAttempted(false);
                    toast.show({ message: t('accessAdmin:role.saved') });
                },
                onError: (error: unknown) => {
                    // `true` means the dialog is open and has the question; anything else falls
                    // through to the banner below, which is where the write failure is rendered.
                    concurrency.capture(error);
                },
            },
        );
    }

    /*
     * Save is pressable over an incomplete role. The press marks the form attempted and takes the
     * reader to the first thing that stops it, on the details step where every one of them lives.
     */
    function attemptSave() {
        if (readOnly) return;
        setAttempted(true);
        const first = issues[0];
        if (first !== undefined) {
            setStep('details');
            focusField(first.fieldId);
            return;
        }
        save();
    }

    const stepLabels: Readonly<Record<RoleStep, string>> = {
        details: t('accessAdmin:role.tabs.details'),
        pages: t('accessAdmin:role.tabs.pages'),
        advanced: t('accessAdmin:role.tabs.advanced'),
    };

    const stepItems: readonly TabItem<RoleStep>[] = ROLE_STEPS.map((key) => ({
        value: key,
        label: stepLabels[key],
        ...(key === 'advanced' ? { count: current.codes.size } : {}),
        ...(key === 'details' && shownIssues.length > 0
            ? {
                  issues: {
                      count: shownIssues.length,
                      tone: 'danger' as const,
                      label: t('kitchen:forms.toFixCount', { count: shownIssues.length }),
                  },
              }
            : {}),
        testID: `kitchen-role-editor-tabs-tab-${key}`,
    }));

    const deletable = !isNew && canManage && record !== undefined && isDeletableRole(record);

    return (
        <>
            <Stack space="md" testID="kitchen-role-editor-screen">
                <RecordFormOpening<RoleStep>
                    testID="kitchen-role-editor"
                    title={title}
                    dirty={guard.isDirty}
                    badges={
                        <>
                            {isTemplate ? (
                                <Badge
                                    variant="label"
                                    testID="kitchen-role-editor-kind"
                                    tone="neutral"
                                    icon={null}
                                    label={t('accessAdmin:roles.kindTemplate')}
                                />
                            ) : null}
                            {isNew || record === undefined ? null : (
                                <Text
                                    testID="kitchen-role-editor-reference"
                                    variant="mono"
                                    tone="secondary"
                                >
                                    {record.code}
                                </Text>
                            )}
                        </>
                    }
                    actions={
                        <>
                            <Button
                                testID="kitchen-role-editor-back"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(() => {
                                        router.back();
                                    });
                                }}
                            />
                            {deletable ? (
                                <Button
                                    testID="kitchen-role-editor-delete"
                                    variant="quiet"
                                    label={t('accessAdmin:role.delete')}
                                    onPress={() => {
                                        setConfirmingDelete(true);
                                    }}
                                />
                            ) : null}
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
                                setStep('details');
                                focusField(issue.fieldId);
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

                {isTemplate ? (
                    <Callout
                        testID="kitchen-role-editor-template-notice"
                        tone="info"
                        title={t('accessAdmin:role.templateNotice')}
                        actions={
                            canManage ? (
                                <Button
                                    testID="kitchen-role-editor-copy"
                                    size="sm"
                                    label={t('accessAdmin:roles.copy')}
                                    onPress={() => {
                                        router.replace(
                                            `/kitchen/roles/new?from=${encodeURIComponent(String(record?.id ?? ''))}` as never,
                                        );
                                    }}
                                />
                            ) : null
                        }
                    />
                ) : null}

                {create.data?.shadowsTemplate === true ? (
                    <Callout
                        testID="kitchen-role-editor-shadows-template"
                        tone="warning"
                        title={t('accessAdmin:role.shadowsTemplate')}
                    />
                ) : null}

                {writeFailure === null ? null : (
                    <Callout
                        testID="kitchen-role-editor-write-error"
                        tone="danger"
                        role="alert"
                        title={
                            writeFailure.code === 'access.self_lockout'
                                ? t('accessAdmin:role.selfLockout')
                                : writeFailure.code === 'resource.conflict' &&
                                    writeFailure.membershipCount !== undefined
                                  ? t('accessAdmin:role.deleteBlocked', {
                                        count: writeFailure.membershipCount,
                                    })
                                  : writeFailure.message
                        }
                    />
                )}

                {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
                <View className="z-auto flex-col">
                    {step !== 'details' ? null : (
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-role-editor-details"
                            title={t('accessAdmin:role.tabs.details')}
                        >
                            {/*
                             * The supplier editor's grid: the reference first, then the bilingual
                             * name across two tracks with its halves side by side, and the
                             * description the same way as paragraphs.
                             */}
                            <FormGrid testID="kitchen-role-editor-details-grid">
                                <TextInputField
                                    testID="kitchen-role-editor-code"
                                    id="kitchen-role-editor-code"
                                    label={t('accessAdmin:role.code')}
                                    placeholder={t('accessAdmin:role.codePlaceholder')}
                                    size="sm"
                                    value={current.code}
                                    autoCapitalize="none"
                                    required={isNew}
                                    // Immutable once the role exists: it is what an invitation
                                    // resolves against, so changing it would redirect every
                                    // outstanding offer.
                                    disabled={readOnly || !isNew}
                                    onChangeText={(value) => {
                                        edit({ code: value });
                                    }}
                                    {...(shows('code')
                                        ? {
                                              error:
                                                  code === ''
                                                      ? t('kitchen:forms.required')
                                                      : t('accessAdmin:role.codeInvalid'),
                                          }
                                        : {})}
                                />

                                <BilingualField
                                    span={2}
                                    layout="row"
                                    testID="kitchen-role-editor-name"
                                    fieldLabel={nameLabel}
                                    placeholder={{
                                        en: t('accessAdmin:role.namePlaceholderEn'),
                                        ar: t('accessAdmin:role.namePlaceholderAr'),
                                    }}
                                    value={{ en: current.nameEn, ar: current.nameAr }}
                                    requiredEnglish
                                    requiredArabic
                                    disabled={readOnly}
                                    onChange={(name) => {
                                        edit({ nameEn: name.en, nameAr: name.ar });
                                    }}
                                    {...(shows('name-en')
                                        ? { englishError: t('kitchen:forms.required') }
                                        : {})}
                                    {...(shows('name-ar')
                                        ? { arabicError: t('kitchen:forms.required') }
                                        : {})}
                                />

                                <BilingualField
                                    fullWidth
                                    layout="row"
                                    multiline
                                    testID="kitchen-role-editor-description"
                                    fieldLabel={t('accessAdmin:role.description')}
                                    placeholder={{
                                        en: t('accessAdmin:role.descriptionPlaceholderEn'),
                                        ar: t('accessAdmin:role.descriptionPlaceholderAr'),
                                    }}
                                    value={{ en: current.descriptionEn, ar: current.descriptionAr }}
                                    disabled={readOnly}
                                    onChange={(description) => {
                                        edit({
                                            descriptionEn: description.en,
                                            descriptionAr: description.ar,
                                        });
                                    }}
                                />
                            </FormGrid>
                        </FormSection>
                    )}

                    {/*
                     * No heading on the two matrix steps: the step tab already names each, and the
                     * matrix's own header row is the first thing under it.
                     */}
                    {step !== 'pages' ? null : (
                        <RolePagesTab
                            testID="kitchen-role-editor-pages"
                            codes={current.codes}
                            disabled={readOnly}
                            onChange={(codes) => {
                                edit({ codes });
                            }}
                        />
                    )}

                    {step !== 'advanced' ? null : (
                        <RolePermissionsTab
                            testID="kitchen-role-editor-advanced"
                            domains={catalogue.data ?? []}
                            codes={current.codes}
                            disabled={readOnly}
                            onChange={(codes) => {
                                edit({ codes });
                            }}
                        />
                    )}
                </View>

                {/*
                 * Save role is the last step's Next, not a header button: a role is read through
                 * to Advanced before it is saved. Not drawn at all on a role this caller cannot
                 * change — every field is locked and the callout above says why — so the last
                 * step keeps a disabled Next instead.
                 */}
                <TabStepNavigation<RoleStep>
                    testID="kitchen-role-editor-steps-nav"
                    items={stepItems}
                    value={step}
                    onChange={setStep}
                    finalAction={
                        readOnly ? undefined : (
                            <Button
                                testID="kitchen-role-editor-save"
                                label={t('accessAdmin:role.save')}
                                loading={create.isPending || update.isPending}
                                disabled={create.isPending || update.isPending}
                                onPress={attemptSave}
                            />
                        )
                    }
                />
            </Stack>

            <EditorGuardDialogs
                testID="kitchen-role-editor"
                guard={guard}
                concurrency={concurrency}
            />

            <Dialog
                testID="kitchen-role-editor-delete-dialog"
                open={confirmingDelete}
                onClose={() => {
                    setConfirmingDelete(false);
                }}
                title={t('accessAdmin:role.deleteTitle', { name: title })}
                description={t('accessAdmin:role.deleteBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-role-editor-delete-cancel"
                            variant="secondary"
                            label={t('accessAdmin:role.cancel')}
                            onPress={() => {
                                setConfirmingDelete(false);
                            }}
                        />
                        <Button
                            testID="kitchen-role-editor-delete-confirm"
                            variant="danger"
                            label={t('accessAdmin:role.deleteConfirm')}
                            loading={remove.isPending}
                            onPress={() => {
                                if (record === undefined) return;
                                remove.mutate(
                                    { role: String(record.id), lockVersion: record.lockVersion },
                                    {
                                        onSuccess: () => {
                                            setConfirmingDelete(false);
                                            toast.show({
                                                message: t('accessAdmin:role.deleted', {
                                                    name: title,
                                                }),
                                            });
                                            router.back();
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            />
        </>
    );
}
