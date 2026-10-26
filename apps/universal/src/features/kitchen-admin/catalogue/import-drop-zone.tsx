import type { ImportUpload } from '@healthy360/api-client/contracts';
import { Button, Icon, Text } from '@healthy360/design-system';
import type { FileUploadRejection } from '@healthy360/design-system';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { IMPORT_MAX_BYTES, XLSX_MIME } from './import-guides.ts';

/**
 * Where the Import dialog takes its workbook: press to choose one, or drop it on the box (web).
 *
 * The same picker `ImageSlot` uses — on the web `expo-document-picker` *is* an
 * `<input type="file">`, on native it is the system picker — and the same drop wiring: React Native
 * Web renders the `View` as a `div` and hands it back through the ref, so the DOM listeners attach
 * to the real node. `Platform.OS` is fixed at build time, so the effect is the same on the server
 * render and the first client one; nothing here reads `window` during render.
 *
 * Both paths run one check before `onPick`. The name *or* the type has to say `.xlsx`, because a
 * file dragged in from Windows Explorer often carries an empty `type`.
 */

export interface ImportDropZoneProps {
    readonly testID: string;
    readonly disabled?: boolean | undefined;
    readonly picked: { readonly name: string; readonly size: number } | null;
    readonly onPick: (upload: ImportUpload, size: number) => void;
    readonly onReject: (reason: FileUploadRejection) => void;
}

/** The limit as the copy states it; `IMPORT_MAX_BYTES` is the number it is checked against. */
const LIMIT_LABEL = '5 MB';

function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rejection(name: string, mime: string, size: number): FileUploadRejection | null {
    if (!name.toLowerCase().endsWith('.xlsx') && mime !== XLSX_MIME) return 'wrong_type';
    if (size > IMPORT_MAX_BYTES) return 'too_large';
    return null;
}

export function ImportDropZone({
    testID,
    disabled = false,
    picked,
    onPick,
    onReject,
}: ImportDropZoneProps) {
    const { t } = useTranslation();
    const node = useRef<View | null>(null);
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        if (Platform.OS !== 'web' || disabled) return undefined;
        const element = node.current as unknown as HTMLElement | null;
        if (element === null || typeof element.addEventListener !== 'function') return undefined;

        // `dragover` has to be cancelled or the browser refuses the drop and opens the file.
        const over = (event: DragEvent) => {
            event.preventDefault();
            setDragging(true);
        };
        const leave = () => {
            setDragging(false);
        };
        const drop = (event: DragEvent) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer?.files[0];
            if (file === undefined) {
                onReject('unreadable');
                return;
            }
            const reason = rejection(file.name, file.type, file.size);
            if (reason !== null) {
                onReject(reason);
                return;
            }
            onPick({ file, fileName: file.name }, file.size);
        };

        element.addEventListener('dragenter', over);
        element.addEventListener('dragover', over);
        element.addEventListener('dragleave', leave);
        element.addEventListener('drop', drop);
        return () => {
            element.removeEventListener('dragenter', over);
            element.removeEventListener('dragover', over);
            element.removeEventListener('dragleave', leave);
            element.removeEventListener('drop', drop);
        };
    }, [disabled, onPick, onReject]);

    const choose = async () => {
        let result: DocumentPicker.DocumentPickerResult;
        try {
            result = await DocumentPicker.getDocumentAsync({
                type: [XLSX_MIME],
                multiple: false,
                copyToCacheDirectory: true,
            });
        } catch {
            onReject('unreadable');
            return;
        }
        if (result.canceled) return;
        const asset = result.assets[0];
        if (asset === undefined) {
            onReject('unreadable');
            return;
        }
        const size = asset.size ?? asset.file?.size ?? 0;
        const reason = rejection(asset.name, asset.mimeType ?? '', size);
        if (reason !== null) {
            onReject(reason);
            return;
        }
        // The web hands back the `File` itself; native gives a cache URI for FormData to stream.
        const file = asset.file ?? {
            uri: asset.uri,
            name: asset.name,
            type: asset.mimeType ?? XLSX_MIME,
        };
        onPick({ file, fileName: asset.name }, size);
    };

    return (
        <View
            ref={node}
            testID={testID}
            className={
                dragging
                    ? 'rounded-md border border-dashed border-stroke-strong bg-surface-raised'
                    : 'rounded-md border border-dashed border-stroke bg-surface-raised'
            }
        >
            <Pressable
                testID={`${testID}-pick`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('kitchen:transfer.dropZone.label')}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                    void choose();
                }}
                className="items-center gap-1 px-4 py-6"
            >
                <Icon name="fileText" className="text-content-secondary" />
                {picked === null ? (
                    <>
                        <Text variant="bodyStrong" align="center">
                            {t('kitchen:transfer.dropZone.title')}
                        </Text>
                        <Text tone="secondary" align="center">
                            {t('kitchen:transfer.dropZone.choose')}
                        </Text>
                    </>
                ) : (
                    <>
                        <Text testID={`${testID}-name`} variant="bodyStrong" align="center">
                            {picked.name}
                        </Text>
                        <Text testID={`${testID}-size`} tone="secondary" align="center">
                            {formatBytes(picked.size)}
                        </Text>
                    </>
                )}
                <Text variant="caption" tone="secondary" align="center">
                    {t('kitchen:transfer.dropZone.limits', { size: LIMIT_LABEL })}
                </Text>
            </Pressable>
            {picked === null ? null : (
                <View className="items-center pb-4">
                    <Button
                        testID={`${testID}-replace`}
                        variant="quiet"
                        size="sm"
                        disabled={disabled}
                        label={t('kitchen:transfer.dropZone.replace')}
                        onPress={() => {
                            void choose();
                        }}
                    />
                </View>
            )}
        </View>
    );
}
