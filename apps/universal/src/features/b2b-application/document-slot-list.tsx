import { Badge, Callout, FileUploadField, Stack, Text } from '@healthy360/design-system';
import type { PickedFile } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { B2BDocumentKind, KycDocument } from './repositories-shim.ts';

/**
 * The document vault, drawn as slots rather than as a list of files.
 *
 * ## Why slots
 *
 * A flat "your uploads" list answers "what have I sent?" and leaves "what do they still want?"
 * to arithmetic the person has to do themselves. A slot per *kind* answers both at once, and it is
 * the shape the server's rule is expressed in: `requiredDocumentKinds` is a list of kinds, not of
 * files.
 *
 * ## The required list comes from the server
 *
 * `requiredKinds` is a prop, never a constant in this module. Which documents an application must
 * carry changes with market and business type, and a client that hard-coded the pair the mock world
 * happens to require would eventually refuse a submission the server would have accepted.
 *
 * ## A rejected document still occupies its slot
 *
 * It is shown, with the reviewer's reason, above the control that replaces it. Hiding it would lose
 * the one piece of information that makes the re-upload useful — *why* the first one was not good
 * enough — and would make the slot look untouched when somebody had in fact already tried.
 */

/** One kind's slot: what is required, what is held, and what a reviewer said about it. */
export interface DocumentSlot {
    readonly kind: B2BDocumentKind;
    readonly required: boolean;
    /** The live document for this kind, if there is one. Superseded rows are not live. */
    readonly current: KycDocument | null;
    /** Earlier attempts, newest first. Usually empty. */
    readonly history: readonly KycDocument[];
}

/**
 * Group the documents by kind.
 *
 * `superseded` and `rejected` rows fall to `history`: a superseded row is a replaced attempt, and a
 * rejected one is an attempt the applicant has to make again. Both stay visible — the decision trail
 * is the point — but neither is the document that counts.
 */
export function buildSlots(
    requiredKinds: readonly B2BDocumentKind[],
    optionalKinds: readonly B2BDocumentKind[],
    documents: readonly KycDocument[],
): readonly DocumentSlot[] {
    const kinds = [
        ...requiredKinds,
        ...optionalKinds.filter((kind) => !requiredKinds.includes(kind)),
    ];

    return kinds.map((kind) => {
        const held = documents.filter((document) => document.kind === kind);
        const current =
            held.find(
                (document) =>
                    document.reviewStatus === 'pending' || document.reviewStatus === 'accepted',
            ) ?? null;
        return {
            kind,
            required: requiredKinds.includes(kind),
            current,
            history: held.filter((document) => document.id !== current?.id),
        };
    });
}

export interface DocumentSlotListProps {
    readonly slots: readonly DocumentSlot[];
    readonly editable: boolean;
    /** The slot currently in flight, if any — only that one shows the spinner. */
    readonly uploadingKind?: B2BDocumentKind | null | undefined;
    readonly onPick: (kind: B2BDocumentKind, file: PickedFile, replaces: string | null) => void;
    readonly onRemove: (documentId: string) => void;
    /** Refused before anything was sent — too large, wrong type, unreadable. */
    readonly rejection?:
        { readonly kind: B2BDocumentKind; readonly message: string } | null | undefined;
    readonly testID?: string | undefined;
}

export function DocumentSlotList({
    slots,
    editable,
    uploadingKind = null,
    onPick,
    onRemove,
    rejection = null,
    testID = 'b2b-documents',
}: DocumentSlotListProps) {
    const { t } = useTranslation();

    return (
        <Stack testID={testID} space="lg">
            {/*
             * Stated once, at the top, rather than per slot: no malware scanning exists yet
             * (INT-008), and a surface that stayed quiet about it would be implying an assurance
             * nobody has built.
             */}
            <Callout
                testID={`${testID}-scan-notice`}
                tone="info"
                role="note"
                title={t('b2bApplication:documents.title')}
                body={t('b2bApplication:documents.scanNotice')}
            />

            {slots.map((slot) => {
                const kindLabel = t(`b2bApplication:documents.kinds.${slot.kind}`);
                const slotTestID = `${testID}-${slot.kind}`;

                return (
                    <View key={slot.kind} testID={slotTestID}>
                        <Stack space="sm">
                            <View className="flex-row items-center gap-2">
                                <Text variant="bodyStrong">{kindLabel}</Text>
                                <Badge
                                    testID={`${slotTestID}-requirement`}
                                    tone={slot.required ? 'warning' : 'neutral'}
                                    label={
                                        slot.required
                                            ? t('b2bApplication:documents.required')
                                            : t('b2bApplication:documents.optional')
                                    }
                                />
                                {slot.current === null ? null : (
                                    <Badge
                                        testID={`${slotTestID}-review-status`}
                                        tone={
                                            slot.current.reviewStatus === 'accepted'
                                                ? 'success'
                                                : 'neutral'
                                        }
                                        label={t(
                                            `b2bApplication:documents.reviewStatus.${slot.current.reviewStatus}`,
                                        )}
                                    />
                                )}
                            </View>

                            {slot.history.map((attempt) => (
                                <Callout
                                    key={attempt.id}
                                    testID={`${slotTestID}-history-${attempt.id}`}
                                    tone={attempt.reviewStatus === 'rejected' ? 'danger' : 'info'}
                                    role="note"
                                    title={`${attempt.fileName} — ${t(
                                        `b2bApplication:documents.reviewStatus.${attempt.reviewStatus}`,
                                    )}`}
                                    body={
                                        attempt.rejectionReason === null
                                            ? undefined
                                            : t(
                                                  `b2bApplication:documents.rejection.${attempt.rejectionReason}`,
                                              )
                                    }
                                />
                            ))}

                            {rejection?.kind === slot.kind ? (
                                <Callout
                                    testID={`${slotTestID}-rejected`}
                                    tone="danger"
                                    role="alert"
                                    title={rejection.message}
                                />
                            ) : null}

                            {editable ? (
                                <FileUploadField
                                    testID={`${slotTestID}-upload`}
                                    id={`${slotTestID}-upload`}
                                    label={kindLabel}
                                    required={slot.required}
                                    uploading={uploadingKind === slot.kind}
                                    {...(slot.current === null
                                        ? {}
                                        : {
                                              attachment: {
                                                  name: slot.current.fileName,
                                                  size: slot.current.byteSize,
                                              },
                                          })}
                                    {...(slot.current === null
                                        ? {}
                                        : {
                                              onRemove: () => {
                                                  onRemove(slot.current?.id ?? '');
                                              },
                                          })}
                                    onPick={(file) => {
                                        onPick(slot.kind, file, slot.current?.id ?? null);
                                    }}
                                />
                            ) : (
                                /*
                                 * Read-only, and drawn as text rather than as a disabled control.
                                 * A greyed-out field at disabled opacity fails contrast — an axe
                                 * "serious" the price-list editor already earned once — and it
                                 * offers an affordance that does nothing. Nothing to press is
                                 * clearer than something that refuses.
                                 */
                                <Text
                                    testID={`${slotTestID}-readonly`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {slot.current === null
                                        ? t('b2bApplication:documents.optional')
                                        : t('b2bApplication:documents.uploaded', {
                                              date: slot.current.uploadedAt,
                                          })}
                                </Text>
                            )}
                        </Stack>
                    </View>
                );
            })}
        </Stack>
    );
}
