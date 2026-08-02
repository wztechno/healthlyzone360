import type { PickedFile } from '@healthy360/design-system';
import {
    Button,
    Callout,
    Checkbox,
    Heading,
    Inline,
    Select,
    Stack,
    Stepper,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { Redirect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useB2BApplicationQuery,
    useRemoveDocumentMutation,
    useSaveSectionMutation,
    useSubmitB2BApplicationMutation,
    useUploadDocumentMutation,
} from '../../../data/b2b-application-hooks.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { DocumentSlotList, buildSlots } from '../document-slot-list.tsx';
import type {
    B2BApplication,
    B2BApplicationSection,
    B2BDocumentKind,
    B2BSectionPayload,
} from '../repositories-shim.ts';
import {
    B2B_STEP_COUNT,
    isApplicantEditable,
    isStepEditable,
    missingDocumentKinds,
    outstandingCount,
    sectionForStep,
    sectionState,
    stepAfter,
    stepBefore,
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
    const removeDocument = useRemoveDocumentMutation();

    const section = sectionForStep(step);
    const position = useMemo(
        () =>
            ['company', 'signatory', 'trade-terms', 'logistics', 'documents', 'review'].indexOf(
                step,
            ) + 1,
        [step],
    );

    const failure = toFailure(save.error) ?? toFailure(submit.error) ?? toFailure(upload.error);

    const goTo = useCallback(
        (slug: B2BStepSlug | null) => {
            router.push((slug === null ? '/apply/status' : `/apply/${slug}`) as never);
        },
        [router],
    );

    return (
        <Stack space="lg" testID={`${TEST_ID}-${step}`}>
            <Stepper
                testID={`${TEST_ID}-progress`}
                label={t('b2bApplication:title')}
                current={position}
                total={B2B_STEP_COUNT}
                stepLabel={
                    section === null
                        ? t(`b2bApplication:${step === 'review' ? 'review' : 'documents'}.title`)
                        : t(`b2bApplication:sections.${section}.title`)
                }
            />

            {/*
             * `resource.conflict` is the one failure with a specific recovery: somebody saved this
             * application somewhere else, so the version on screen is stale. Reload-or-keep, drawn
             * the way the kitchen editors draw it.
             */}
            {failure?.code === 'resource.conflict' ? (
                <Callout
                    testID={`${TEST_ID}-conflict`}
                    role="alert"
                    tone="warning"
                    title={t('b2bApplication:wizard.conflictTitle')}
                    body={t('b2bApplication:wizard.conflictBody')}
                />
            ) : failure === null ? null : (
                <Callout
                    testID={`${TEST_ID}-error`}
                    role="alert"
                    tone="danger"
                    title={failure.message}
                />
            )}

            {step === 'documents' ? (
                <DocumentsStep
                    application={application}
                    uploading={upload.isPending ? (upload.variables?.kind ?? null) : null}
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
                    onRemove={(documentId) => {
                        removeDocument.mutate({ applicationId: application.id, documentId });
                    }}
                />
            ) : step === 'review' ? (
                <ReviewStep
                    application={application}
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

            <Inline space="sm">
                {stepBefore(step) === null ? null : (
                    <Button
                        testID={`${TEST_ID}-back`}
                        variant="ghost"
                        label={t('b2bApplication:wizard.back')}
                        onPress={() => {
                            goTo(stepBefore(step));
                        }}
                    />
                )}
                {step === 'documents' ? (
                    <Button
                        testID={`${TEST_ID}-next`}
                        label={t('b2bApplication:wizard.next')}
                        onPress={() => {
                            goTo(stepAfter(step));
                        }}
                    />
                ) : null}
            </Inline>
        </Stack>
    );
}

/* ── the four field sections ──────────────────────────────────────────────────────────────────── */

function SectionStep({
    application,
    section,
    saving,
    onSave,
}: {
    readonly application: B2BApplication;
    readonly section: B2BApplicationSection;
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
    const [draft, setDraft] = useState<Record<string, unknown>>(() => ({
        // Through `unknown`: the section interfaces have no index signature — which is the point of
        // typing them — and this form reads and writes only the keys the field table names.
        ...(application.sections[section] as unknown as Record<string, unknown>),
    }));
    const [errors, setErrors] = useState<SectionErrors>({});

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

    return (
        <Stack space="md" testID={`${TEST_ID}-section-${section}`}>
            <Stack space="xs">
                <Heading level={1} testID={`${TEST_ID}-heading`}>
                    {t(`b2bApplication:sections.${section}.title`)}
                </Heading>
                <Text tone="secondary">{t(`b2bApplication:sections.${section}.description`)}</Text>
            </Stack>

            {state?.complete === false && state.missingFields.length > 0 ? (
                <Callout
                    testID={`${TEST_ID}-missing`}
                    tone="info"
                    role="status"
                    title={t('b2bApplication:wizard.incomplete')}
                    body={state.missingFields
                        .map((field) => t(`b2bApplication:fields.${field}`))
                        .join(', ')}
                />
            ) : null}

            {FIELDS[section].map((field) => {
                const label = t(`b2bApplication:fields.${field.name}`);
                const hint = field.hint ? t(`b2bApplication:hints.${field.name}`) : undefined;
                const fieldTestID = `${TEST_ID}-${field.name}`;

                if (field.kind === 'select') {
                    const options = VOCABULARIES[field.vocabulary].map((value) => ({
                        value,
                        label: t(`b2bApplication:${field.vocabulary}.${value}`),
                    }));
                    return (
                        <Select
                            key={field.name}
                            testID={fieldTestID}
                            id={fieldTestID}
                            label={label}
                            {...(hint === undefined ? {} : { hint })}
                            required={field.required}
                            options={options}
                            value={typeof draft[field.name] === 'string' ? text(field.name) : null}
                            onChange={(value) => {
                                set(field.name, value);
                            }}
                            {...(errorFor(field.name) === undefined
                                ? {}
                                : { error: errorFor(field.name) })}
                        />
                    );
                }

                if (field.kind === 'boolean') {
                    return (
                        <Checkbox
                            key={field.name}
                            testID={fieldTestID}
                            id={fieldTestID}
                            label={label}
                            checked={draft[field.name] === true}
                            onChange={(checked) => {
                                set(field.name, checked);
                            }}
                        />
                    );
                }

                return (
                    <TextInputField
                        key={field.name}
                        testID={fieldTestID}
                        id={fieldTestID}
                        label={label}
                        {...(hint === undefined ? {} : { hint })}
                        required={field.required}
                        multiline={field.kind === 'multiline'}
                        {...(field.kind === 'number' ? { inputMode: 'numeric' as const } : {})}
                        value={field.kind === 'number' ? numeric(field.name) : text(field.name)}
                        onChangeText={(next) => {
                            if (field.kind === 'number') {
                                const digits = next.replace(/\D/gu, '');
                                set(field.name, digits.length === 0 ? null : Number(digits));
                            } else {
                                set(field.name, next);
                            }
                        }}
                        {...(errorFor(field.name) === undefined
                            ? {}
                            : { error: errorFor(field.name) })}
                    />
                );
            })}

            <Button
                testID={`${TEST_ID}-save`}
                label={t('b2bApplication:wizard.save')}
                loading={saving}
                onPress={() => {
                    const result = validateSection(section, draft);
                    if (!result.ok) {
                        setErrors(result.errors);
                        return;
                    }
                    setErrors({});
                    onSave(result.value as B2BSectionPayload, true);
                }}
            />
        </Stack>
    );
}

/* ── documents ────────────────────────────────────────────────────────────────────────────────── */

function DocumentsStep({
    application,
    uploading,
    onUpload,
    onRemove,
}: {
    readonly application: B2BApplication;
    readonly uploading: B2BDocumentKind | null;
    readonly onUpload: (kind: B2BDocumentKind, file: PickedFile, replaces: string | null) => void;
    readonly onRemove: (documentId: string) => void;
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
        <Stack space="md" testID={`${TEST_ID}-documents-body`}>
            <Stack space="xs">
                <Heading level={1}>{t('b2bApplication:documents.title')}</Heading>
                <Text tone="secondary">{t('b2bApplication:documents.description')}</Text>
            </Stack>

            <Text testID={`${TEST_ID}-documents-outstanding`} tone="secondary" variant="caption">
                {t('b2bApplication:documents.missing', { count: missing.length })}
            </Text>

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
                onRemove={onRemove}
            />
        </Stack>
    );
}

/* ── review and send ──────────────────────────────────────────────────────────────────────────── */

function ReviewStep({
    application,
    submitting,
    onEdit,
    onSubmit,
}: {
    readonly application: B2BApplication;
    readonly submitting: boolean;
    readonly onEdit: (slug: B2BStepSlug) => void;
    readonly onSubmit: () => void;
}) {
    const { t } = useTranslation();

    const outstanding = outstandingCount(application);
    const ready = outstanding === 0;

    return (
        <Stack space="md" testID={`${TEST_ID}-review`}>
            <Stack space="xs">
                <Heading level={1}>{t('b2bApplication:review.title')}</Heading>
                <Text tone="secondary">{t('b2bApplication:review.body')}</Text>
            </Stack>

            <Text testID={`${TEST_ID}-outstanding`} tone="secondary" variant="caption">
                {t('b2bApplication:wizard.outstanding', { count: outstanding })}
            </Text>

            {application.sectionStates.map((state) => (
                <Stack key={state.section} space="xs" testID={`${TEST_ID}-review-${state.section}`}>
                    <Text variant="bodyStrong">
                        {t(`b2bApplication:sections.${state.section}.title`)}
                    </Text>
                    <Text tone={state.complete ? 'success' : 'warning'} variant="caption">
                        {state.complete
                            ? t('b2bApplication:wizard.complete')
                            : t('b2bApplication:wizard.incomplete')}
                    </Text>
                    <Button
                        testID={`${TEST_ID}-review-${state.section}-edit`}
                        variant="ghost"
                        size="sm"
                        label={t('b2bApplication:review.edit')}
                        onPress={() => {
                            onEdit(
                                state.section === 'trade_terms'
                                    ? 'trade-terms'
                                    : (state.section as B2BStepSlug),
                            );
                        }}
                    />
                </Stack>
            ))}

            {ready ? null : (
                <Callout
                    testID={`${TEST_ID}-blocked`}
                    tone="warning"
                    role="status"
                    title={t('b2bApplication:review.blockedTitle')}
                    body={t('b2bApplication:review.blockedBody')}
                />
            )}

            <Button
                testID={`${TEST_ID}-submit`}
                label={t('b2bApplication:review.submit')}
                loading={submitting}
                disabled={!ready}
                onPress={onSubmit}
            />
        </Stack>
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
          readonly kind: 'select';
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
