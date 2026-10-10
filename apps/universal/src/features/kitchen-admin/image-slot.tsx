import { Icon } from '@healthy360/design-system';
import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Platform, Pressable, Text as RNText, View } from 'react-native';

/**
 * The record's photo, as the Catalogue Forms editors draw it: a 168px square at the start of
 * Identity, dashed while empty and solid once filled, with a clear control in its corner.
 *
 * ```
 * ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
 * ╎      (+)      ╎   <- press to choose, or drop a file on it (web)
 * ╎     Image     ╎
 * └╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
 * ```
 *
 * ## Nothing stores it yet
 *
 * Neither `IngredientAdmin` nor `RecipeAdmin` has an image field, and no endpoint takes one. The
 * slot is drawn now, as the design asks, and holds the chosen file in the editor's own state — so
 * it survives moving between tabs and is gone once the reader leaves the page. The caller owns the
 * value (`uri`) precisely so the day an upload endpoint exists, the editor adds it to its save and
 * this component does not change.
 *
 * ## One picker on both platforms
 *
 * `expo-document-picker` with an image filter, for the reason `FileUploadField` gives: on the web it
 * *is* an `<input type="file">`, and on native it is the system picker, with one accept rule written
 * once. Dropping a file is a web affordance only, attached to the element React Native Web renders —
 * native has no drag source to receive from.
 */

export interface ImageSlotProps {
    /** A local handle to the chosen image — an object URL on the web, a cache path on native. */
    readonly uri: string | null;
    readonly onChange: (uri: string | null) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

/** The design's slot, and one track of the half grid beside it plus its gap: 132 + 16 + 20. */
const SLOT_SIZE = 168;

export function ImageSlot({ uri, onChange, disabled = false, testID }: ImageSlotProps) {
    const { t } = useTranslation();
    const node = useRef<View | null>(null);

    /*
     * Drop, on the web. React Native Web renders a `View` as a `div` and hands that element back
     * through the ref, so the two DOM listeners attach to the real node without a web-only file.
     * `dragover` has to be cancelled or the browser refuses the drop and opens the file instead.
     */
    useEffect(() => {
        if (Platform.OS !== 'web' || disabled) return undefined;
        const element = node.current as unknown as HTMLElement | null;
        if (element === null || typeof element.addEventListener !== 'function') return undefined;

        const over = (event: DragEvent) => {
            event.preventDefault();
        };
        const drop = (event: DragEvent) => {
            event.preventDefault();
            const file = event.dataTransfer?.files[0];
            if (file === undefined || !file.type.startsWith('image/')) return;
            onChange(URL.createObjectURL(file));
        };

        element.addEventListener('dragover', over);
        element.addEventListener('drop', drop);
        return () => {
            element.removeEventListener('dragover', over);
            element.removeEventListener('drop', drop);
        };
    }, [disabled, onChange]);

    const pick = async () => {
        const result = await DocumentPicker.getDocumentAsync({
            type: 'image/*',
            multiple: false,
            copyToCacheDirectory: true,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (asset !== undefined) onChange(asset.uri);
    };

    return (
        <View
            ref={node}
            testID={testID}
            style={{ width: SLOT_SIZE, height: SLOT_SIZE }}
            className={
                uri === null
                    ? 'shrink-0 overflow-hidden rounded-md border border-dashed border-stroke bg-surface-sunken'
                    : 'shrink-0 overflow-hidden rounded-md border border-stroke bg-surface-sunken'
            }
        >
            <Pressable
                testID={`${testID}-pick`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('kitchen:forms.imagePick')}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                    void pick();
                }}
                className="h-full w-full items-center justify-center gap-hair"
            >
                {uri === null ? (
                    <>
                        <View className="h-7 w-7 items-center justify-center rounded-full border border-stroke bg-surface-raised">
                            <Icon name="plus" size="sm" className="text-content-on-brand-subtle" />
                        </View>
                        <RNText className="text-role-caption text-content-secondary">
                            {t('kitchen:forms.image')}
                        </RNText>
                    </>
                ) : (
                    <Image
                        testID={`${testID}-preview`}
                        source={{ uri }}
                        resizeMode="cover"
                        accessibilityIgnoresInvertColors
                        style={{ width: '100%', height: '100%' }}
                    />
                )}
            </Pressable>

            {uri === null || disabled ? null : (
                <Pressable
                    testID={`${testID}-clear`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('kitchen:forms.imageRemove')}
                    onPress={() => {
                        onChange(null);
                    }}
                    className="absolute end-1.5 top-1.5 h-6 w-6 items-center justify-center rounded-sm border border-stroke bg-surface-raised hover:bg-danger-subtle"
                >
                    <Icon name="close" size="sm" className="text-content-secondary" />
                </Pressable>
            )}
        </View>
    );
}
