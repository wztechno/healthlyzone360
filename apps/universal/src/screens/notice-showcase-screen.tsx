import { Button, DensityProvider, Inline, Notice, Stack, Text } from '@healthy360/design-system';
import type { NoticeTone } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

interface Example {
    readonly tone: NoticeTone;
    readonly title: string;
    readonly body: string;
    readonly primary: string;
    readonly secondary?: string;
}

/** The four tones, each in the words the design gives it. */
const EXAMPLES: readonly Example[] = [
    {
        tone: 'warning',
        title: '1 thing before saving',
        body: 'Confirm the nutrition match first.',
        primary: 'Show me',
        secondary: 'Not now',
    },
    {
        tone: 'danger',
        title: 'Throw away your changes?',
        body: 'The page goes back to how it was last saved.',
        primary: 'Throw away',
        secondary: 'Keep them',
    },
    {
        tone: 'info',
        title: 'No Arabic name yet',
        body: 'Customers reading Arabic see the English name.',
        primary: 'Add it',
        secondary: 'Later',
    },
    {
        tone: 'success',
        title: 'Lentil soup is live',
        body: 'Customers can order it from today.',
        primary: 'Back to Recipes',
        secondary: 'Stay on recipe',
    },
];

/**
 * `/showcase-notices` — the notice on its own page, as the user asked for redesign parts
 * (2026-10-24). One button per tone opens it. The blocked-save notice with "Show me", wired to a
 * real tray, is on `/showcase-issue-tray`.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
export function NoticeShowcaseScreen() {
    const [open, setOpen] = useState<NoticeTone | null>(null);
    const close = () => {
        setOpen(null);
    };

    return (
        <DensityProvider value="compact">
            <View className="mx-auto w-full max-w-[960px] p-6">
                <Stack space="md" testID="notice-showcase">
                    <Text variant="title">Notices</Text>
                    <Inline space="sm" wrap>
                        {EXAMPLES.map((example) => (
                            <Button
                                key={example.tone}
                                testID={`notice-showcase-open-${example.tone}`}
                                variant="secondary"
                                label={example.title}
                                onPress={() => {
                                    setOpen(example.tone);
                                }}
                            />
                        ))}
                    </Inline>
                </Stack>
                {EXAMPLES.map((example) => (
                    <Notice
                        key={example.tone}
                        testID={`notice-showcase-${example.tone}`}
                        open={open === example.tone}
                        onClose={close}
                        tone={example.tone}
                        title={example.title}
                        body={example.body}
                        primary={{ label: example.primary, onPress: close }}
                        {...(example.secondary === undefined
                            ? {}
                            : { secondary: { label: example.secondary, onPress: close } })}
                    />
                ))}
            </View>
        </DensityProvider>
    );
}
