import { Text } from '../primitives/text.tsx';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

/**
 * "● Unsaved changes", beside an editor's title while it holds changes not yet saved (2026-11-23,
 * replacing the save bar and the warning badge). A dot and a line of warning ink — quiet enough to
 * sit next to the title, and the same mark on every kitchen editor.
 */
export function UnsavedMark({ testID }: { readonly testID: string }) {
    const { t } = useTranslation();
    return (
        <View testID={testID} className="flex-row items-center gap-1.5">
            <View aria-hidden className="h-2 w-2 rounded-full bg-warning-border" />
            <Text variant="label" tone="warning">
                {t('designSystem:unsavedMark.label')}
            </Text>
        </View>
    );
}
