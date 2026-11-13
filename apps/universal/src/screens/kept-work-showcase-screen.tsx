import { Button, DensityProvider, Inline, Stack, Text } from '@healthy360/design-system';
import { View } from 'react-native';

import { UnsavedDialog } from '../features/kitchen-admin/record-form-opening.tsx';
import { keepWork } from '../navigation/kept-work.ts';
import { clearAllSessionDrafts } from '../navigation/session-draft.ts';
import { useUnsavedGuard } from '../navigation/use-unsaved-guard.ts';

/**
 * `/showcase-kept-work` — "Leave this page?" with Keep for later, and the card and top-bar pill
 * that list what was kept (`shell/kept-work-dock.tsx`), as settled with the user on 2026-10-29.
 * The card and pill are the page shell's own, as on every page: keep something to see them.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function KeptWorkShowcaseScreen() {
    const keepable = useUnsavedGuard({ message: 'Unsaved', keepsDraft: true });
    const plain = useUnsavedGuard({ message: 'Unsaved' });

    const keepSample = (key: string, kind: 'recipe' | 'ingredient', subject: string | null) => {
        keepWork({
            kind,
            subject,
            href: `/kitchen/${kind === 'recipe' ? 'recipes' : 'ingredients'}/${key}`,
            draft: { namespace: 'showcase', key },
        });
    };

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[960px] p-6">
                <Stack space="md" testID="kept-work-showcase">
                    <Text variant="title">Kept work</Text>
                    <Inline space="sm" wrap>
                        <Button
                            testID="kept-work-showcase-leave-keepable"
                            variant="secondary"
                            label="Leave a recipe"
                            onPress={() => {
                                keepable.markDirty();
                                keepable.intercept(() => undefined);
                            }}
                        />
                        <Button
                            testID="kept-work-showcase-leave-plain"
                            variant="secondary"
                            label="Leave a product"
                            onPress={() => {
                                plain.markDirty();
                                plain.intercept(() => undefined);
                            }}
                        />
                        <Button
                            testID="kept-work-showcase-keep-ingredient"
                            variant="secondary"
                            label="Keep a new ingredient"
                            onPress={() => {
                                keepSample('new', 'ingredient', null);
                            }}
                        />
                        <Button
                            testID="kept-work-showcase-keep-recipe"
                            variant="secondary"
                            label="Keep a recipe"
                            onPress={() => {
                                keepSample('recipe-1', 'recipe', 'Bbq Sauce Dip');
                            }}
                        />
                        <Button
                            testID="kept-work-showcase-clear"
                            variant="quiet"
                            label="Clear"
                            onPress={clearAllSessionDrafts}
                        />
                    </Inline>
                </Stack>
                <UnsavedDialog guard={keepable} testID="kept-work-showcase-keepable" />
                <UnsavedDialog guard={plain} testID="kept-work-showcase-plain" />
            </View>
        </DensityProvider>
    );
}
