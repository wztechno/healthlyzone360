import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Button } from '../actions/button.tsx';
import { cx } from '../internal/class-names.ts';
import { Spinner } from '../status/spinner.tsx';
import { FormField } from './form-field.tsx';

/**
 * A file picker for the one thing this platform asks people to upload: a document that proves
 * something about a company (plan Phase B1, appendix E §D.1).
 *
 * ## One picker, both platforms
 *
 * `expo-document-picker` rather than a web `<input type="file">` beside a native image library.
 * Two implementations would be two sets of accept rules, two cancel behaviours and two ways to be
 * wrong about a size limit, for a control whose whole job is to be predictable. The web
 * implementation of the module *is* an `<input type="file">`; the difference is that the accept
 * list, the multiple flag and the cancelled-result shape are written once.
 *
 * ## No fake progress
 *
 * `uploading` draws an **indeterminate** spinner and nothing else. A determinate bar would need a
 * byte counter the upload does not publish, so any percentage shown here would be an animation
 * timed to look plausible — and the one moment it matters, a stalled upload on a bad connection, is
 * exactly when a bar creeping towards 90 % is a lie. "Uploading…" with a spinner is less
 * satisfying and true.
 *
 * ## The size limit is checked here *and* server-side
 *
 * {@link FILE_UPLOAD_MAX_BYTES} is one exported constant, so the client cap and every message that
 * quotes it come from the same number. The check is a courtesy — it saves a person a ten-megabyte
 * upload that was always going to be refused — and it is **not** a control: the server sniffs the
 * bytes, enforces its own ceiling and does not trust the declared type. A client-side check that
 * were the only one would be defeated by a `curl`.
 *
 * ## The bytes, and where they are not read
 *
 * On the web the picker reads the file and hands back a data URL, which this component strips to
 * bare base64. **On native it does not**: reading a `file://` URI needs `expo-file-system`, and
 * this slice was approved for exactly one new dependency. So {@link PickedFile.base64} is
 * `string | null`, the null case is a real case, and a caller must decide what to do with a picked
 * file it cannot read rather than being handed an empty string that looks like content. The B1
 * screens surface it as an honest message; the API repository will upload the URI as multipart,
 * which is the right native answer anyway and needs no base64 at all.
 */

/** The client-side ceiling, in bytes. Ten megabytes (plan Phase B1). One constant, quoted everywhere. */
export const FILE_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * What the vault accepts.
 *
 * Three types, and no accept-anything escape hatch: the server sniffs magic bytes and refuses
 * everything else, so offering a person a `.docx` here would be offering them a rejection.
 */
export const FILE_UPLOAD_MIME_TYPES: readonly string[] = [
    'application/pdf',
    'image/jpeg',
    'image/png',
];

/** Why a picked file was refused before it was ever sent. */
export const FILE_UPLOAD_REJECTIONS = ['too_large', 'wrong_type', 'unreadable'] as const;
export type FileUploadRejection = (typeof FILE_UPLOAD_REJECTIONS)[number];

/** A file the person chose, after the client-side checks passed. */
export interface PickedFile {
    readonly name: string;
    readonly size: number;
    readonly mimeType: string;
    /** The local handle. On the web an object URL; on native a cache-directory path. */
    readonly uri: string;
    /** Bare base64 — no data-URL prefix. `null` on native; see the header. */
    readonly base64: string | null;
}

export interface FileUploadFieldProps {
    readonly label: string;
    readonly hint?: string | undefined;
    /** Validation message. Its presence marks the control invalid, as on every other field. */
    readonly error?: string | undefined;
    readonly required?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    /** Draws the indeterminate spinner and closes the control. Never a percentage. */
    readonly uploading?: boolean | undefined;
    /** Overrides the accept list. Defaults to {@link FILE_UPLOAD_MIME_TYPES}. */
    readonly accept?: readonly string[] | undefined;
    /** Overrides the client cap. Defaults to {@link FILE_UPLOAD_MAX_BYTES}. */
    readonly maxBytes?: number | undefined;
    /** The file already attached, if any — drawn as a summary row with a remove control. */
    readonly attachment?: { readonly name: string; readonly size: number } | undefined;
    readonly onRemove?: (() => void) | undefined;
    readonly onPick: (file: PickedFile) => void;
    /**
     * A file the person chose that this component refused.
     *
     * Separate from `error` because the caller owns the copy *and* the placement: a rejection is
     * about the attempt, not about the field's current value, and some callers show it as a toast.
     */
    readonly onReject?: ((rejection: FileUploadRejection) => void) | undefined;
    readonly id?: string | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/** `data:application/pdf;base64,JVBER…` → `JVBER…`. Anything else is passed through. */
function stripDataUrl(value: string): string {
    const comma = value.indexOf(',');
    return value.startsWith('data:') && comma > 0 ? value.slice(comma + 1) : value;
}

/** Kilobytes and megabytes, one decimal place. Sizes are the one number this control formats. */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${String(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploadField({
    label,
    hint,
    error,
    required = false,
    disabled = false,
    uploading = false,
    accept = FILE_UPLOAD_MIME_TYPES,
    maxBytes = FILE_UPLOAD_MAX_BYTES,
    attachment,
    onRemove,
    onPick,
    onReject,
    id,
    className,
    testID = 'file-upload',
}: FileUploadFieldProps) {
    const { t } = useTranslation();
    const [picking, setPicking] = useState(false);

    const busy = picking || uploading;
    const closed = disabled || busy;

    const choose = useCallback(async () => {
        setPicking(true);
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: [...accept],
                multiple: false,
                base64: true,
                copyToCacheDirectory: true,
            });
            if (result.canceled) return;

            const asset = result.assets[0];
            // A picker that returned success with nothing in it is not a cancellation and must not
            // be silently swallowed — the person pressed a button and deserves an answer.
            if (asset === undefined) {
                onReject?.('unreadable');
                return;
            }

            const mimeType = asset.mimeType ?? '';
            if (!accept.includes(mimeType)) {
                onReject?.('wrong_type');
                return;
            }

            const size = asset.size ?? 0;
            if (size > maxBytes) {
                onReject?.('too_large');
                return;
            }

            onPick({
                name: asset.name,
                size,
                mimeType,
                uri: asset.uri,
                base64: asset.base64 === undefined ? null : stripDataUrl(asset.base64),
            });
        } catch {
            // The picker itself failed — a permission refusal, a provider that died. The person
            // sees a refusal rather than a button that did nothing.
            onReject?.('unreadable');
        } finally {
            setPicking(false);
        }
    }, [accept, maxBytes, onPick, onReject]);

    return (
        <FormField
            label={label}
            {...(hint === undefined ? {} : { hint })}
            {...(error === undefined ? {} : { error })}
            required={required}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            testID={testID}
        >
            {(control) => (
                <View
                    // The control the label points at is this group, not the button: a
                    // button whose accessible name is already "Choose a file" would read as
                    // "Trade licence Choose a file Choose a file, button" with the label on it too.
                    nativeID={control.nativeID}
                    role="group"
                    aria-labelledby={control['aria-labelledby']}
                    accessibilityLabel={control.accessibilityLabel}
                    {...(control['aria-describedby'] === undefined
                        ? {}
                        : { 'aria-describedby': control['aria-describedby'] })}
                    {...(control.accessibilityHint === undefined
                        ? {}
                        : { accessibilityHint: control.accessibilityHint })}
                    aria-invalid={control['aria-invalid']}
                    aria-required={control['aria-required']}
                    className={cx(
                        'flex-col gap-2 rounded-lg border border-dashed p-3',
                        control['aria-invalid'] ? 'border-danger-border' : 'border-stroke',
                        disabled ? 'bg-surface-sunken opacity-60' : 'bg-surface-base',
                    )}
                >
                    {attachment === undefined ? null : (
                        <View
                            testID={`${testID}-attachment`}
                            className="flex-row items-center gap-2"
                        >
                            <RNText
                                testID={`${testID}-attachment-name`}
                                className="flex-1 text-sm text-content-primary text-start"
                                numberOfLines={1}
                            >
                                {attachment.name}
                            </RNText>
                            <RNText className="text-xs text-content-secondary">
                                {formatBytes(attachment.size)}
                            </RNText>
                            {onRemove === undefined ? null : (
                                <Button
                                    testID={`${testID}-remove`}
                                    variant="ghost"
                                    size="sm"
                                    disabled={closed}
                                    label={t('designSystem:fileUpload.remove')}
                                    onPress={onRemove}
                                />
                            )}
                        </View>
                    )}

                    <View className="flex-row items-center gap-3">
                        <Button
                            testID={`${testID}-choose`}
                            variant="secondary"
                            size="sm"
                            disabled={closed}
                            label={
                                attachment === undefined
                                    ? t('designSystem:fileUpload.choose')
                                    : t('designSystem:fileUpload.replace')
                            }
                            onPress={() => {
                                void choose();
                            }}
                        />
                        {/*
                         * Indeterminate, and labelled. `Spinner` renders `role="progressbar"`
                         * with no `aria-valuenow`, which is the correct encoding for "something is
                         * happening and nobody knows how far along it is".
                         */}
                        {busy ? (
                            <Spinner
                                testID={`${testID}-busy`}
                                size="small"
                                showLabel
                                label={t('designSystem:fileUpload.uploading')}
                            />
                        ) : null}
                    </View>

                    <RNText
                        testID={`${testID}-limits`}
                        className="text-xs text-content-secondary text-start"
                    >
                        {t('designSystem:fileUpload.limits', {
                            size: formatBytes(maxBytes),
                        })}
                    </RNText>
                </View>
            )}
        </FormField>
    );
}
