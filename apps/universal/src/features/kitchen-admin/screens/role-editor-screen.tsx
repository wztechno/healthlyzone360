import { apiFailure, isDeletableRole } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    Skeleton,
    Stack,
    Tabs,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useCreateRoleMutation,
    useDeleteRoleMutation,
    useOrganisationRoleQuery,
    usePermissionCatalogueQuery,
    useUpdateRoleMutation,
} from '../../../data/access-admin-hooks.ts';
import { toFailure } from '../../../data/hooks.ts';
import { ROLE_MANAGE_PERMISSION, ROLE_VIEW_PERMISSION } from '../entity-registry.ts';
import { OpsRecordFrame } from '../ops-record-frame.tsx';
import { toSavedCodes } from '../page-permissions.ts';
import { RolePagesTab } from '../role-pages-tab.tsx';
import { RolePermissionsTab } from '../role-permissions-tab.tsx';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/roles/{role}` and `/kitchen/roles/new` — one editor, three jobs.
 *
 * It creates a role, edits one, and reads a platform template it cannot change. They are one screen
 * because they are one form: the difference between them is which fields are writable and which
 * button appears, not which controls exist.
 *
 * ## Copy is a create seeded from a read
 *
 * `/kitchen/roles/new?from={role}` fetches the source and pre-fills from it. That is the only
 * supported way to change what a platform template means inside a kitchen — acceptance prefers a
 * tenant's own role of the same code — so the code field is left editable and pre-filled with the
 * source's, and the form warns if it is kept rather than refusing it.
 *
 * ## The two tabs write the same state
 *
 * Both edit one `Set` of codes held here. Pages owns only the codes the registry names, so a save
 * made entirely on that tab keeps the publish codes and the own-scope six — the invariant
 * `page-permissions.ts` states and its test pins. Advanced can reach everything. Switching between
 * them mid-edit loses nothing, because there is nothing to lose: one set, two views of it.
 *
 * ## A template is read-only and says so once
 *
 * The frame hides Save, both tabs are disabled and a callout explains why and what to do instead.
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

interface Draft {
    readonly code: string;
    readonly nameEn: string;
    readonly nameAr: string;
    readonly descriptionEn: string;
    readonly descriptionAr: string;
    readonly codes: ReadonlySet<string>;
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
    const [tab, setTab] = useState<'pages' | 'advanced'>('pages');
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    const guard = useUnsavedGuard({ message: t('kitchen:editor.unsavedMessage') });

    const record = source.data;
    const isTemplate = !isNew && record?.isSystem === true;
    const readOnly = isTemplate || !canManage;

    // Null until the person edits: while the form is clean the fetched record is the truth, so a
    // refetch is reflected rather than overwritten by stale local state.
    const current: Draft = useMemo(() => {
        if (draft !== null) return draft;

        if (record === undefined) {
            return { code: '', nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '', codes: new Set() };
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

    function edit(patch: Partial<Draft>) {
        setDraft({ ...current, ...patch });
        guard.markDirty();
    }

    const loading = (sourceId !== undefined && source.isPending) || catalogue.isPending;
    const failure = toFailure(source.error) ?? toFailure(catalogue.error);
    const writeFailure = toFailure(create.error) ?? toFailure(update.error) ?? toFailure(remove.error);

    if (loading) {
        return (
            <Stack space="sm" testID="kitchen-role-editor-loading">
                {Array.from({ length: 3 }, (_, index) => (
                    <Card key={index} padding="md">
                        <Skeleton heightClassName="h-5" />
                    </Card>
                ))}
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

    const title = isNew
        ? record === undefined
            ? t('accessAdmin:role.newTitle')
            : t('accessAdmin:role.copyTitle', {
                  name: locale.startsWith('ar') ? record.nameAr : record.nameEn,
              })
        : locale.startsWith('ar')
          ? current.nameAr
          : current.nameEn;

    function save() {
        const permissions = toSavedCodes(current.codes);
        const body = {
            nameEn: current.nameEn,
            nameAr: current.nameAr,
            descriptionEn: current.descriptionEn.trim() === '' ? null : current.descriptionEn.trim(),
            descriptionAr: current.descriptionAr.trim() === '' ? null : current.descriptionAr.trim(),
            permissions,
        };

        if (isNew) {
            create.mutate(
                { ...body, code: current.code },
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
                    toast.show({ message: t('accessAdmin:role.saved') });
                },
            },
        );
    }

    return (
        <>
            <OpsRecordFrame
                testID="kitchen-role-editor"
                title={title}
                guard={guard}
                onBack={() => {
                    guard.intercept(() => {
                        router.back();
                    });
                }}
                backLabel={t('accessAdmin:role.back')}
                onSave={save}
                saveLabel={t('accessAdmin:role.save')}
                saving={create.isPending || update.isPending}
                hideSave={readOnly}
                saveDisabled={current.nameEn.trim() === '' || current.code.trim() === ''}
                primaryAction={
                    !isNew && canManage && record !== undefined && isDeletableRole(record) ? (
                        <Button
                            testID="kitchen-role-editor-delete"
                            size="sm"
                            variant="secondary"
                            label={t('accessAdmin:role.delete')}
                            onPress={() => {
                                setConfirmingDelete(true);
                            }}
                        />
                    ) : null
                }
                banner={
                    <Stack space="sm">
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
                    </Stack>
                }
            >
                <Stack space="lg">
                    <Card padding="md">
                        <Stack space="md">
                            <TextInputField
                                testID="kitchen-role-editor-name-en"
                                label={t('accessAdmin:role.nameEn')}
                                value={current.nameEn}
                                disabled={readOnly}
                                required
                                onChangeText={(value) => {
                                    edit({ nameEn: value });
                                }}
                            />
                            <TextInputField
                                testID="kitchen-role-editor-name-ar"
                                label={t('accessAdmin:role.nameAr')}
                                value={current.nameAr}
                                disabled={readOnly}
                                onChangeText={(value) => {
                                    edit({ nameAr: value });
                                }}
                            />
                            <TextInputField
                                testID="kitchen-role-editor-code"
                                label={t('accessAdmin:role.code')}
                                hint={t('accessAdmin:role.codeHint')}
                                value={current.code}
                                autoCapitalize="none"
                                // Immutable once the role exists: it is what an invitation resolves
                                // against, so changing it would redirect every outstanding offer.
                                disabled={readOnly || !isNew}
                                onChangeText={(value) => {
                                    edit({ code: value });
                                }}
                            />
                            <TextInputField
                                testID="kitchen-role-editor-description-en"
                                label={t('accessAdmin:role.descriptionEn')}
                                value={current.descriptionEn}
                                disabled={readOnly}
                                multiline
                                onChangeText={(value) => {
                                    edit({ descriptionEn: value });
                                }}
                            />
                        </Stack>
                    </Card>

                    <Tabs<'pages' | 'advanced'>
                        testID="kitchen-role-editor-tabs"
                        label={t('accessAdmin:role.tabs.pages')}
                        items={[
                            {
                                value: 'pages',
                                label: t('accessAdmin:role.tabs.pages'),
                                testID: 'kitchen-role-editor-tabs-tab-pages',
                            },
                            {
                                value: 'advanced',
                                label: t('accessAdmin:role.tabs.advanced'),
                                count: current.codes.size,
                                testID: 'kitchen-role-editor-tabs-tab-advanced',
                            },
                        ]}
                        value={tab}
                        onChange={setTab}
                    />

                    {tab === 'pages' ? (
                        <RolePagesTab
                            testID="kitchen-role-editor-pages"
                            codes={current.codes}
                            disabled={readOnly}
                            onChange={(codes) => {
                                edit({ codes });
                            }}
                        />
                    ) : (
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
                </Stack>
            </OpsRecordFrame>

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
