import type {
    B2BApplication,
    B2BApplicationSection,
    B2BDocumentKind,
    B2BSectionPayload,
} from '@healthy360/api-client/contracts';
import type { PickedFile } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { Checkbox, Icon, Select, TextInputField, cx } from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    toFailure,
    useB2BApplicationQuery,
    useReplaceContactsMutation,
    useReplaceLocationsMutation,
    useSaveSectionMutation,
    useSubmitB2BApplicationMutation,
    useUploadDocumentMutation,
} from '../../../data/b2b-application-hooks.ts';
import { guardNavigation, useUnsavedGuardFor } from '../../../navigation/use-unsaved-guard.ts';
import { UnsavedChangesDialog } from '../../../ui/unsaved-changes-dialog.tsx';
import {
    ExtraButton,
    ExtraChip,
    ExtraLink,
    ExtraNote,
    ExtraPage,
} from '../../account/account-extra.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { STEP_ICONS, SavedAsYouGo, StepCard, StepRail } from '../apply-ui.tsx';
import { DocumentSlotList, buildSlots } from '../document-slot-list.tsx';
import { ContactsStep, LocationsStep } from '../list-steps.tsx';
import {
    isApplicantEditable,
    isStepComplete,
    isStepEditable,
    missingDocumentKinds,
    outstandingCount,
    sectionForStep,
    sectionState,
    stepAfter,
    stepBefore,
    stepForSection,
    validateSection,
} from '../sections.ts';
import type { B2BStepSlug, SectionErrors } from '../sections.ts';
import { OPTIONAL_DOCUMENT_KINDS, VOCABULARIES } from '../vocabularies.ts';

/**
 * `/apply/{section}` — one step of the wizard.
 *
 * ## The draft is on the server, and this screen holds nothing that is not on screen
 *
 * The form's state is the values the server last gave us plus whatever the person has typed since.
 * There is no accumulating local draft that gets flushed at the end — the plan is explicit
 * ("application wizard (server-side draft)") and the quotation builder is the counter-example that
 * made it explicit. Practically: a save is a real round trip, the answer replaces the form's basis,
 * and closing the tab loses at most the current step's unsaved keystrokes.
 *
 * ## The deep link redirects, and it redirects somewhere useful
 *
 * A step that is not editable in the current state sends the person to `/apply/status` — an approved
 * application opened at `/apply/company` must not show an editable form nobody will read. A step
 * that is fine to open stays put, keeping the address they typed.
 *
 * ## Validation is client-side *and* the server's rule is the one that counts
 *
 * The schemas in `../sections.ts` stop a malformed value being sent. Whether the application is
 * *ready* is `sectionState.complete`, which is the server's evaluator — this screen never
 * recomputes it, because a client that disagreed would either block a valid submission or promise
 * an invalid one.
 */

const TEST_ID = 'b2b-apply-step';

export interface ApplyStepScreenProps {
    readonly step: B2BStepSlug;
}

export function ApplyStepScreen({ step }: ApplyStepScreenProps) {
    const { t } = useTranslation();
    const application = useB2BApplicationQuery();

    const current = application.data ?? null;

    return (
        <QueryStates
            query={application}
            isEmpty={false}
            emptyTitle={t('b2bApplication:title')}
            testID={TEST_ID}
        >
            {current === null ? (
                // Nothing to edit: the entry screen owns "you have not applied yet".
                <Redirect href={'/apply' as never} />
            ) : !isApplicantEditable(current) || !isStepEditable(current, step) ? (
                <Redirect href={'/apply/status' as never} />
            ) : (
                <StepBody application={current} step={step} />
            )}
        </QueryStates>
    );
}

function StepBody({
    application,
    step,
}: {
    readonly application: B2BApplication;
    readonly step: B2BStepSlug;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    const save = useSaveSectionMutation();
    const submit = useSubmitB2BApplicationMutation();
    const upload = useUploadDocumentMutation();
    const replaceContacts = useReplaceContactsMutation();
    const replaceLocations = useReplaceLocationsMutation();

    const section = sectionForStep(step);

    // Every write this screen can make, so no failure goes unsaid.
    const failure =
        toFailure(save.error) ??
        toFailure(submit.error) ??
        toFailure(upload.error) ??
        toFailure(replaceContacts.error) ??
        toFailure(replaceLocations.error);

    const goTo = useCallback(
        (slug: B2BStepSlug | null) => {
            router.push((slug === null ? '/apply/status' : `/apply/${slug}`) as never);
        },
        [router],
    );

    const labelOf = (slug: B2BStepSlug): string => {
        const owned = sectionForStep(slug);
        return owned === null
            ? t(`b2bApplication:${slug}.title`)
            : t(`b2bApplication:sections.${owned}.title`);
    };

    /*
     * The step's Back, in the card's footer. Through the step's guard: typed and not saved, it asks
     * first. The first step has none, and an empty view keeps the footer's other end in place.
     */
    const previous = stepBefore(step);
    const back =
        previous === null ? (
            <View />
        ) : (
            <ExtraButton
                testID={`${TEST_ID}-back`}
                tone="secondary"
                label={t('b2bApplication:wizard.back')}
                onPress={() => {
                    guardNavigation(() => {
                        goTo(previous);
                    });
                }}
            />
        );

    return (
        <ExtraPage
            wide
            testID={`${TEST_ID}-${step}`}
            backTestID={`${TEST_ID}-to-business`}
            backLabel={t('marketplace:nav.business')}
            onBack={() => {
                guardNavigation(() => {
                    router.push('/for-business' as never);
                });
            }}
            icon="building"
            title={t('b2bApplication:entry.title')}
        >
            {/*
             * `resource.conflict` is the one failure with a specific recovery: somebody saved this
             * application somewhere else, so the version on screen is stale.
             */}
            {failure?.code === 'resource.conflict' ? (
                <View className="mt-[18px]">
                    <ExtraNote
                        testID={`${TEST_ID}-conflict`}
                        role="alert"
                        tone="amber"
                        icon="warning"
                        title={t('b2bApplication:wizard.conflictTitle')}
                        body={t('b2bApplication:wizard.conflictBody')}
                    />
                </View>
            ) : failure === null ? null : (
                <View className="mt-[18px]">
                    <ExtraNote
                        testID={`${TEST_ID}-error`}
                        role="alert"
                        tone="bad"
                        icon="warning"
                        title={failure.message}
                    />
                </View>
            )}

            <View className="mt-[22px] flex-col gap-6 lg:flex-row lg:items-start">
                <View className="w-full lg:w-[260px]">
                    <StepRail
                        testID={`${TEST_ID}-progress`}
                        current={step}
                        labelOf={labelOf}
                        stateOf={(slug) =>
                            slug === step
                                ? 'current'
                                : !isStepEditable(application, slug)
                                  ? 'locked'
                                  : isStepComplete(application, slug)
                                    ? 'done'
                                    : 'open'
                        }
                        onOpen={(slug) => {
                            guardNavigation(() => {
                                goTo(slug);
                            });
                        }}
                    />
                </View>
                <View className="min-w-0 flex-1">
                    {step === 'contacts' ? (
                        <ContactsStep
                            application={application}
                            saving={replaceContacts.isPending}
                            back={back}
                            onSave={(contacts) => {
                                replaceContacts.mutate(
                                    { applicationId: application.id, contacts },
                                    {
                                        onSuccess: () => {
                                            goTo(stepAfter(step));
                                        },
                                    },
                                );
                            }}
                        />
                    ) : step === 'locations' ? (
                        <LocationsStep
                            application={application}
                            saving={replaceLocations.isPending}
                            back={back}
                            onSave={(locations) => {
                                replaceLocations.mutate(
                                    { applicationId: application.id, locations },
                                    {
                                        onSuccess: () => {
                                            goTo(stepAfter(step));
                                        },
                                    },
                                );
                            }}
                        />
                    ) : step === 'documents' ? (
                        <DocumentsStep
                            application={application}
                            back={back}
                            uploading={upload.isPending ? (upload.variables?.kind ?? null) : null}
                            onNext={() => {
                                goTo(stepAfter(step));
                            }}
                            onUpload={(kind, file, replaces) => {
                                upload.mutate({
                                    applicationId: application.id,
                                    kind,
                                    fileName: file.name,
                                    mimeType: file.mimeType,
                                    byteSize: file.size,
                                    content: file.base64 ?? '',
                                    ...(replaces === null ? {} : { replacesDocumentId: replaces }),
                                });
                            }}
                        />
                    ) : step === 'review' ? (
                        <ReviewStep
                            application={application}
                            back={back}
                            submitting={submit.isPending}
                            onEdit={goTo}
                            onSubmit={() => {
                                submit.mutate(
                                    {
                                        applicationId: application.id,
                                        lockVersion: application.lockVersion,
                                    },
                                    {
                                        onSuccess: () => {
                                            router.replace('/apply/status' as never);
                                        },
                                    },
                                );
                            }}
                        />
                    ) : section === null ? null : (
                        <SectionStep
                            application={application}
                            section={section}
                            step={step}
                            back={back}
                            saving={save.isPending}
                            onSave={(payload, markComplete) => {
                                save.mutate(
                                    {
                                        applicationId: application.id,
                                        section,
                                        payload,
                                        markComplete,
                                        lockVersion: application.lockVersion,
                                    },
                                    {
                                        onSuccess: () => {
                                            goTo(stepAfter(step));
                                        },
                                    },
                                );
                            }}
                        />
                    )}
                </View>
            </View>
        </ExtraPage>
    );
}

/* ── the four field sections ──────────────────────────────────────────────────────────────────── */

function SectionStep({
    application,
    section,
    step,
    back,
    saving,
    onSave,
}: {
    readonly application: B2BApplication;
    readonly section: B2BApplicationSection;
    readonly step: B2BStepSlug;
    readonly back: ReactNode;
    readonly saving: boolean;
    readonly onSave: (payload: B2BSectionPayload, markComplete: boolean) => void;
}) {
    const { t } = useTranslation();

    /**
     * The form's basis is the server's values; `draft` is what has been typed since.
     *
     * Keyed by section so moving between steps does not carry one step's edits into another, and
     * seeded lazily so a refetch that lands mid-typing does not wipe the field under the caret.
     */
    const [seed] = useState<Record<string, unknown>>(() => ({
        // Through `unknown`: the section interfaces have no index signature — which is the point of
        // typing them — and this form reads and writes only the keys the field table names.
        ...(application.sections[section] as unknown as Record<string, unknown>),
    }));
    const [draft, setDraft] = useState<Record<string, unknown>>(seed);
    const [errors, setErrors] = useState<SectionErrors>({});
    // Typed and not saved: Back, the browser's Back and closing the tab ask first.
    const guard = useUnsavedGuardFor(JSON.stringify(draft) !== JSON.stringify(seed), {
        message: t('common:unsaved.browserPrompt'),
    });

    const state = sectionState(application, section);
    const set = (field: string, value: unknown) => {
        setDraft((previous) => ({ ...previous, [field]: value }));
    };

    const text = (field: string): string => {
        const value = draft[field];
        return typeof value === 'string' ? value : '';
    };
    const numeric = (field: string): string => {
        const value = draft[field];
        return typeof value === 'number' ? String(value) : '';
    };
    /** The rule fired, translated. `validateSection` answers a reason key; the copy lives here. */
    const errorFor = (field: string): string | undefined => {
        const reason = errors[field];
        return reason === undefined ? undefined : t(`b2bApplication:validation.${reason}`);
    };

    const saveSection = () => {
        const result = validateSection(section, draft);
        if (!result.ok) {
            setErrors(result.errors);
            return;
        }
        setErrors({});
        onSave(result.value as B2BSectionPayload, true);
    };

    return (
        <StepCard
            icon={STEP_ICONS[step]}
            title={t(`b2bApplication:sections.${section}.title`)}
            titleTestID={`${TEST_ID}-heading`}
            lede={t(`b2bApplication:sections.${section}.description`)}
            footer={
                <>
                    {back}
                    <SavedAsYouGo />
                    <ExtraButton
                        testID={`${TEST_ID}-save`}
                        label={t('b2bApplication:wizard.save')}
                        icon="arrowForward"
                        busy={saving}
                        onPress={saveSection}
                    />
                </>
            }
        >
            <View testID={`${TEST_ID}-section-${section}`} className="flex-col gap-4">
                {state?.complete === false && state.missingFields.length > 0 ? (
                    <ExtraNote
                        testID={`${TEST_ID}-missing`}
                        tone="amber"
                        icon="infoCircle"
                        title={t('b2bApplication:wizard.incomplete')}
                        body={state.missingFields
                            .map((field) => t(`b2bApplication:fields.${field}`))
                            .join(', ')}
                    />
                ) : null}

                {/* The board's form: fields two to a row, the wide ones across both. */}
                <View className="flex-row flex-wrap gap-x-4 gap-y-3.5">
                    {FIELDS[section].map((field) => {
                        const label = t(`b2bApplication:fields.${field.name}`);
                        const hint = field.hint
                            ? t(`b2bApplication:hints.${field.name}`)
                            : undefined;
                        const fieldTestID = `${TEST_ID}-${field.name}`;
                        const wide =
                            field.kind === 'multiline' ||
                            field.kind === 'multiselect' ||
                            field.kind === 'boolean';
                        const cell = wide ? 'w-full' : 'min-w-[240px] flex-1 basis-[45%]';

                        if (field.kind === 'select') {
                            const options = VOCABULARIES[field.vocabulary].map((value) => ({
                                value,
                                label: t(`b2bApplication:${field.vocabulary}.${value}`),
                            }));
                            return (
                                <View key={field.name} className={cell}>
                                    <Select
                                        testID={fieldTestID}
                                        id={fieldTestID}
                                        label={label}
                                        {...(hint === undefined ? {} : { hint })}
                                        required={field.required}
                                        options={options}
                                        value={
                                            typeof draft[field.name] === 'string'
                                                ? text(field.name)
                                                : null
                                        }
                                        onChange={(value) => {
                                            set(field.name, value);
                                        }}
                                        {...(errorFor(field.name) === undefined
                                            ? {}
                                            : { error: errorFor(field.name) })}
                                    />
                                </View>
                            );
                        }

                        if (field.kind === 'multiselect') {
                            // The board's option chips: a pill each, ticked when chosen.
                            const picked = Array.isArray(draft[field.name])
                                ? (draft[field.name] as readonly string[])
                                : [];
                            return (
                                <View
                                    key={field.name}
                                    testID={fieldTestID}
                                    role="group"
                                    aria-label={label}
                                    className={cx(cell, 'flex-col gap-2')}
                                >
                                    <RNText className="text-sm font-semibold text-content-primary text-start">
                                        {label}
                                    </RNText>
                                    <View className="flex-row flex-wrap gap-2">
                                        {VOCABULARIES[field.vocabulary].map((value) => {
                                            const on = picked.includes(value);
                                            return (
                                                <Pressable
                                                    key={value}
                                                    testID={`${fieldTestID}-${value}`}
                                                    role="checkbox"
                                                    accessibilityRole="checkbox"
                                                    aria-checked={on}
                                                    accessibilityState={{ checked: on }}
                                                    onPress={() => {
                                                        // Kept in the vocabulary's order, not the order ticked.
                                                        set(
                                                            field.name,
                                                            VOCABULARIES[field.vocabulary].filter(
                                                                (option) =>
                                                                    option === value
                                                                        ? !on
                                                                        : picked.includes(option),
                                                            ),
                                                        );
                                                    }}
                                                    className={cx(
                                                        'h-11 flex-row items-center gap-2 rounded-[14px] border-[1.5px] px-3.5 transition-colors duration-150',
                                                        on
                                                            ? 'border-surface-brand bg-surface-brand-subtle'
                                                            : 'border-stroke bg-surface-raised hover:bg-surface-base',
                                                    )}
                                                >
                                                    {on ? (
                                                        <Icon
                                                            name="check"
                                                            size="sm"
                                                            className="text-content-on-brand-subtle"
                                                        />
                                                    ) : null}
                                                    <RNText
                                                        className={cx(
                                                            'text-sm font-semibold',
                                                            on
                                                                ? 'text-content-on-brand-subtle'
                                                                : 'text-content-primary',
                                                        )}
                                                    >
                                                        {t(
                                                            `b2bApplication:${field.vocabulary}.${value}`,
                                                        )}
                                                    </RNText>
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                            );
                        }

                        if (field.kind === 'boolean') {
                            return (
                                <View key={field.name} className={cell}>
                                    <Checkbox
                                        testID={fieldTestID}
                                        id={fieldTestID}
                                        label={label}
                                        checked={draft[field.name] === true}
                                        onChange={(checked) => {
                                            set(field.name, checked);
                                        }}
                                    />
                                </View>
                            );
                        }

                        return (
                            <View key={field.name} className={cell}>
                                <TextInputField
                                    testID={fieldTestID}
                                    id={fieldTestID}
                                    label={label}
                                    placeholder={t(
                                        `b2bApplication:fields.${field.name}Placeholder`,
                                    )}
                                    {...(hint === undefined ? {} : { hint })}
                                    required={field.required}
                                    multiline={field.kind === 'multiline'}
                                    // A number field keeps its half-track cap, but fills up to it
                                    // rather than shrinking to its placeholder in the row.
                                    className="w-full"
                                    {...(field.kind === 'number'
                                        ? { inputMode: 'numeric' as const }
                                        : {})}
                                    value={
                                        field.kind === 'number'
                                            ? numeric(field.name)
                                            : text(field.name)
                                    }
                                    onChangeText={(next) => {
                                        if (field.kind === 'number') {
                                            const digits = next.replace(/\D/gu, '');
                                            set(
                                                field.name,
                                                digits.length === 0 ? null : Number(digits),
                                            );
                                        } else {
                                            set(field.name, next);
                                        }
                                    }}
                                    {...(errorFor(field.name) === undefined
                                        ? {}
                                        : { error: errorFor(field.name) })}
                                />
                            </View>
                        );
                    })}
                </View>
            </View>
            <UnsavedChangesDialog guard={guard} testID={`${TEST_ID}-unsaved`} />
        </StepCard>
    );
}

/* ── documents ────────────────────────────────────────────────────────────────────────────────── */

function DocumentsStep({
    application,
    back,
    uploading,
    onUpload,
    onNext,
}: {
    readonly application: B2BApplication;
    readonly back: ReactNode;
    readonly uploading: B2BDocumentKind | null;
    readonly onUpload: (kind: B2BDocumentKind, file: PickedFile, replaces: string | null) => void;
    readonly onNext: () => void;
}) {
    const { t } = useTranslation();

    /** A file this device could not read. Native has no base64; the web does. */
    const [unreadable, setUnreadable] = useState<B2BDocumentKind | null>(null);

    const slots = useMemo(
        () =>
            buildSlots(
                application.requiredDocumentKinds,
                OPTIONAL_DOCUMENT_KINDS,
                application.documents,
            ),
        [application.requiredDocumentKinds, application.documents],
    );

    const missing = missingDocumentKinds(application);

    return (
        <StepCard
            icon={STEP_ICONS.documents}
            title={t('b2bApplication:documents.title')}
            titleTestID={`${TEST_ID}-heading`}
            lede={t('b2bApplication:documents.description')}
            footer={
                <>
                    {back}
                    <SavedAsYouGo />
                    <ExtraButton
                        testID={`${TEST_ID}-next`}
                        label={t('b2bApplication:wizard.next')}
                        icon="arrowForward"
                        onPress={onNext}
                    />
                </>
            }
        >
            <View testID={`${TEST_ID}-documents-body`} className="flex-col gap-4">
                <View className="flex-row">
                    <ExtraChip
                        testID={`${TEST_ID}-documents-outstanding`}
                        tone={missing.length === 0 ? 'ok' : 'amber'}
                        label={t('b2bApplication:documents.missing', { count: missing.length })}
                    />
                </View>

                <DocumentSlotList
                    slots={slots}
                    editable
                    uploadingKind={uploading}
                    {...(unreadable === null
                        ? {}
                        : {
                              rejection: {
                                  kind: unreadable,
                                  message: t('b2bApplication:documents.unreadableOnDevice'),
                              },
                          })}
                    onPick={(kind, file, replaces) => {
                        // No bytes means nothing to send. Saying so beats an empty upload that the
                        // server would refuse for a reason the person cannot act on.
                        if (file.base64 === null) {
                            setUnreadable(kind);
                            return;
                        }
                        setUnreadable(null);
                        onUpload(kind, file, replaces);
                    }}
                />
            </View>
        </StepCard>
    );
}

/* ── review and send ──────────────────────────────────────────────────────────────────────────── */

function ReviewStep({
    application,
    back,
    submitting,
    onEdit,
    onSubmit,
}: {
    readonly application: B2BApplication;
    readonly back: ReactNode;
    readonly submitting: boolean;
    readonly onEdit: (slug: B2BStepSlug) => void;
    readonly onSubmit: () => void;
}) {
    const { t } = useTranslation();

    const outstanding = outstandingCount(application);
    const ready = outstanding === 0;
    const missingDocuments = missingDocumentKinds(application);

    return (
        <StepCard
            icon={STEP_ICONS.review}
            title={t('b2bApplication:review.title')}
            titleTestID={`${TEST_ID}-heading`}
            lede={t('b2bApplication:review.body')}
            footer={
                <>
                    {back}
                    <SavedAsYouGo />
                    <ExtraButton
                        testID={`${TEST_ID}-submit`}
                        label={t('b2bApplication:review.submit')}
                        icon="arrowForward"
                        busy={submitting}
                        disabled={!ready}
                        onPress={onSubmit}
                    />
                </>
            }
        >
            <View testID={`${TEST_ID}-review`} className="flex-col">
                {ready ? (
                    <RNText
                        testID={`${TEST_ID}-outstanding`}
                        className="text-sm font-medium text-content-secondary text-start"
                    >
                        {t('b2bApplication:wizard.outstanding', { count: outstanding })}
                    </RNText>
                ) : (
                    <ExtraNote
                        testID={`${TEST_ID}-blocked`}
                        tone="bad"
                        icon="warning"
                        title={t('b2bApplication:review.blockedTitle')}
                        body={`${t('b2bApplication:wizard.outstanding', { count: outstanding })} ${t('b2bApplication:review.blockedBody')}`}
                    />
                )}

                <View className="mt-2">
                    {application.sectionStates.map((state) => (
                        <ReviewRow
                            key={state.section}
                            testID={`${TEST_ID}-review-${state.section}`}
                            icon={STEP_ICONS[stepForSection(state.section)]}
                            title={t(`b2bApplication:sections.${state.section}.title`)}
                            detail={
                                // The server's missing-field list, named, so the applicant learns
                                // what is left here rather than from a refused submission.
                                state.missingFields.length === 0
                                    ? undefined
                                    : state.missingFields
                                          .map((field) => t(`b2bApplication:fields.${field}`))
                                          .join(', ')
                            }
                            detailTestID={`${TEST_ID}-review-${state.section}-missing`}
                            chip={
                                state.complete ? (
                                    <ExtraChip
                                        tone="ok"
                                        label={t('b2bApplication:wizard.complete')}
                                    />
                                ) : (
                                    <ExtraChip
                                        tone="bad"
                                        label={t('b2bApplication:wizard.incomplete')}
                                    />
                                )
                            }
                            {...(state.editable
                                ? {
                                      onEdit: () => {
                                          onEdit(stepForSection(state.section));
                                      },
                                  }
                                : {})}
                        />
                    ))}

                    {/*
                     * Contacts and locations are not submission rules — the server sends without
                     * them — so an empty one reads "not added yet" and never holds the button back.
                     */}
                    {(['contacts', 'locations'] as const).map((slug) => (
                        <ReviewRow
                            key={slug}
                            testID={`${TEST_ID}-review-${slug}`}
                            icon={STEP_ICONS[slug]}
                            title={t(`b2bApplication:${slug}.title`)}
                            {...(isStepComplete(application, slug)
                                ? {}
                                : { detail: t('b2bApplication:review.notAddedYet') })}
                            chip={
                                isStepComplete(application, slug) ? (
                                    <ExtraChip
                                        tone="ok"
                                        label={t('b2bApplication:wizard.complete')}
                                    />
                                ) : (
                                    <ExtraChip
                                        tone="mute"
                                        label={t('b2bApplication:wizard.optional')}
                                    />
                                )
                            }
                            onEdit={() => {
                                onEdit(slug);
                            }}
                        />
                    ))}

                    <ReviewRow
                        testID={`${TEST_ID}-review-documents`}
                        icon={STEP_ICONS.documents}
                        title={t('b2bApplication:documents.title')}
                        {...(missingDocuments.length === 0
                            ? {}
                            : {
                                  detail: t('b2bApplication:review.blockedDocuments', {
                                      kinds: missingDocuments
                                          .map((kind) =>
                                              t(`b2bApplication:documents.kinds.${kind}`),
                                          )
                                          .join(', '),
                                  }),
                              })}
                        detailTestID={`${TEST_ID}-review-documents-missing`}
                        chip={
                            missingDocuments.length === 0 ? (
                                <ExtraChip tone="ok" label={t('b2bApplication:wizard.complete')} />
                            ) : (
                                <ExtraChip
                                    tone="bad"
                                    label={t('b2bApplication:wizard.incomplete')}
                                />
                            )
                        }
                        onEdit={() => {
                            onEdit('documents');
                        }}
                    />
                </View>
            </View>
        </StepCard>
    );
}

/** One line of "Check and send": the step's glyph, its name, what is left, its state, and Change. */
function ReviewRow({
    testID,
    icon,
    title,
    detail,
    detailTestID,
    chip,
    onEdit,
}: {
    readonly testID: string;
    readonly icon: IconName;
    readonly title: string;
    readonly detail?: string | undefined;
    readonly detailTestID?: string | undefined;
    readonly chip: ReactNode;
    readonly onEdit?: (() => void) | undefined;
}) {
    const { t } = useTranslation();
    return (
        <View
            testID={testID}
            className="flex-row flex-wrap items-center gap-3 border-t border-stroke-subtle py-3 first:border-t-0"
        >
            <View className="h-10 w-10 items-center justify-center rounded-[13px] bg-surface-base">
                <Icon name={icon} size="md" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="text-base font-semibold text-content-primary text-start">
                    {title}
                </RNText>
                {detail === undefined ? null : (
                    <RNText
                        testID={detailTestID}
                        className="mt-0.5 text-sm text-content-secondary text-start"
                    >
                        {detail}
                    </RNText>
                )}
            </View>
            {chip}
            {onEdit === undefined ? null : (
                <ExtraLink
                    testID={`${testID}-edit`}
                    label={t('b2bApplication:review.edit')}
                    onPress={onEdit}
                />
            )}
        </View>
    );
}

/* ── the field table ──────────────────────────────────────────────────────────────────────────── */

type FieldDescriptor =
    | {
          readonly name: string;
          readonly kind: 'text' | 'multiline' | 'number';
          readonly required: boolean;
          readonly hint?: boolean;
      }
    | {
          readonly name: string;
          readonly kind: 'select' | 'multiselect';
          readonly required: boolean;
          readonly vocabulary: keyof typeof VOCABULARIES;
          readonly hint?: boolean;
      }
    | {
          readonly name: string;
          readonly kind: 'boolean';
          readonly required: boolean;
          readonly hint?: boolean;
      };

/**
 * Which controls each section draws, in order.
 *
 * A table rather than four hand-written forms: the sections differ in *which fields* they hold, not
 * in how a field behaves, and four copies of the same label-hint-error wiring is four places for one
 * of them to lose its `aria-describedby`.
 */
const FIELDS: Readonly<Record<B2BApplicationSection, readonly FieldDescriptor[]>> = {
    company: [
        { name: 'legalName', kind: 'text', required: true, hint: true },
        { name: 'legalNameAr', kind: 'text', required: false },
        { name: 'tradingName', kind: 'text', required: false, hint: true },
        { name: 'businessType', kind: 'select', required: false, vocabulary: 'businessTypes' },
        { name: 'countryCode', kind: 'text', required: true },
        { name: 'commercialRegistrationNumber', kind: 'text', required: true },
        { name: 'taxRegistrationNumber', kind: 'text', required: false, hint: true },
        { name: 'incorporatedOn', kind: 'text', required: false },
        { name: 'website', kind: 'text', required: false },
    ],
    signatory: [
        { name: 'signatoryName', kind: 'text', required: true },
        { name: 'signatoryTitle', kind: 'text', required: true, hint: true },
        { name: 'signatoryEmail', kind: 'text', required: true },
        { name: 'signatoryPhone', kind: 'text', required: false },
    ],
    trade_terms: [
        {
            name: 'requestedPaymentTerms',
            kind: 'select',
            required: true,
            vocabulary: 'paymentTerms',
        },
        { name: 'requestedCreditLimitMinor', kind: 'number', required: false, hint: true },
        { name: 'currencyCode', kind: 'text', required: false },
        { name: 'expectedVolumeBand', kind: 'select', required: false, vocabulary: 'volumeBands' },
        {
            name: 'expectedOrderFrequency',
            kind: 'select',
            required: false,
            vocabulary: 'orderFrequencies',
        },
        {
            name: 'productCategories',
            kind: 'multiselect',
            required: false,
            vocabulary: 'productCategories',
        },
    ],
    logistics: [
        {
            name: 'preferredDeliveryWindow',
            kind: 'select',
            required: false,
            vocabulary: 'deliveryWindows',
        },
        { name: 'leadTimeDays', kind: 'number', required: false, hint: true },
        { name: 'requiresInvoicePerLocation', kind: 'boolean', required: false },
        { name: 'deliveryNotes', kind: 'multiline', required: false, hint: true },
    ],
};
