import {
    Callout,
    DensityProvider,
    Dialog,
    Inline,
    OfflineIndicator,
    Stack,
    Text,
    ToastLookScope,
    useToast,
} from '@healthy360/design-system';
import type { ToastOptions } from '@healthy360/design-system';
import { useState } from 'react';
import { View } from 'react-native';

import { DeskButton } from '../features/kitchen-admin/desk-kit/desk-button.tsx';
import { FailureToast } from '../features/kitchen-admin/failure-toast.tsx';
import { UndoBar } from '../features/kitchen-admin/row-editor-shell.tsx';
import { SaveBarProvider, SaveBarSlot, useSaveBar } from '../features/kitchen-admin/save-bar.tsx';

/**
 * `/showcase-feedback` — the kitchen's toasts, pop-ups and notice strips, from the Toasts / pop-ups /
 * banners canvas (2026-11-11), each as the admin draws it: the desk toast, the card pop-up, the
 * notice strip (the compact `Callout`), the dark system bar, the in-place undo, the save bar at the
 * page's foot and a refused write said as a toast.
 *
 * Literal copy, like `/showcase`: a development page, never a customer one.
 */
const TOASTS: readonly { readonly label: string; readonly toast: ToastOptions }[] = [
    { label: 'Saved', toast: { tone: 'success', message: 'Supplier saved' } },
    { label: 'Info', toast: { tone: 'info', message: 'Copied to clipboard' } },
    {
        label: 'Warning + action',
        toast: {
            tone: 'warning',
            message: 'Saved — 2 prices still missing',
            action: { label: 'Show', onPress: () => undefined },
        },
    },
    {
        label: 'Failed',
        toast: {
            tone: 'danger',
            message: 'Couldn’t save — you’re offline',
            action: { label: 'Try again', onPress: () => undefined },
        },
    },
    {
        label: 'With a title',
        toast: {
            tone: 'success',
            title: 'Supply order sent',
            message: 'PO-0142 to Fresh Produce · 12 items',
            action: { label: 'Open', onPress: () => undefined },
        },
    },
    {
        label: 'Undo',
        toast: {
            undo: true,
            message: 'Basmati rice archived',
            durationMs: 6000,
            action: { label: 'Undo', onPress: () => undefined },
        },
    },
];

export function FeedbackShowcaseScreen() {
    return (
        <ToastLookScope look="desk">
            <DensityProvider value="compact">
                <SaveBarProvider>
                    <Parts />
                </SaveBarProvider>
            </DensityProvider>
        </ToastLookScope>
    );
}

function Parts() {
    const toast = useToast();
    const [confirming, setConfirming] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [changes, setChanges] = useState(0);
    const [refused, setRefused] = useState<Error | null>(null);
    useSaveBar({
        dirty: changes > 0,
        toFix: changes > 1 ? 2 : 0,
        save: {
            testID: 'feedback-showcase-save',
            label: 'Save',
            onPress: () => {
                setChanges(0);
                toast.show({ tone: 'success', message: 'Supplier saved' });
            },
        },
        discard: {
            testID: 'feedback-showcase-discard',
            label: 'Discard',
            onPress: () => {
                setChanges(0);
            },
        },
        testID: 'feedback-showcase',
    });

    return (
        <View className="mx-auto w-full max-w-[960px] p-6">
            <Stack space="lg" testID="feedback-showcase">
                <Text variant="title">Toasts, pop-ups and banners</Text>

                <Stack space="sm">
                    <Text variant="label">Toast — bottom centre</Text>
                    <Inline space="sm" wrap>
                        {TOASTS.map((sample) => (
                            <DeskButton
                                key={sample.label}
                                variant="secondary"
                                label={sample.label}
                                onPress={() => {
                                    toast.show(sample.toast);
                                }}
                            />
                        ))}
                    </Inline>
                </Stack>

                <Stack space="sm">
                    <Text variant="label">Pop-up — the question, one line, the verb</Text>
                    <Inline space="sm">
                        <DeskButton
                            testID="feedback-showcase-confirm"
                            variant="secondary"
                            label="Archive Basmati rice"
                            onPress={() => {
                                setConfirming(true);
                            }}
                        />
                    </Inline>
                </Stack>

                <Stack space="sm">
                    <Text variant="label">Notice strip — one line, 40px</Text>
                    <Callout
                        tone="info"
                        title="Read only."
                        body="Your role can see this list but not change it."
                    />
                    <Callout
                        tone="warning"
                        title="5 items have no price."
                        body="They won’t show in the shop."
                        actions={<DeskButton size="sm" variant="secondary" label="Show them" />}
                    />
                    <Callout
                        tone="danger"
                        role="alert"
                        title="Couldn’t load the orders."
                        actions={<DeskButton size="sm" variant="secondary" label="Try again" />}
                    />
                    {dismissed ? null : (
                        <Callout
                            tone="success"
                            title="All stock gaps are fixed."
                            dismissLabel="Dismiss"
                            onDismiss={() => {
                                setDismissed(true);
                            }}
                        />
                    )}
                </Stack>

                <Stack space="sm">
                    <Text variant="label">System bar — the app’s own state</Text>
                    <OfflineIndicator look="bar" state="offline" />
                    <OfflineIndicator look="bar" state="reconnecting" />
                </Stack>

                <Stack space="sm">
                    <Text variant="label">
                        Save bar — at the page's foot while there is something to save
                    </Text>
                    <Inline space="sm" wrap>
                        <DeskButton
                            testID="feedback-showcase-edit"
                            variant="secondary"
                            label="Change a field"
                            onPress={() => {
                                setChanges((count) => count + 1);
                            }}
                        />
                        <DeskButton
                            testID="feedback-showcase-refuse"
                            variant="secondary"
                            label="A save the server refuses"
                            onPress={() => {
                                setRefused(
                                    new Error('The price list changed while you were editing.'),
                                );
                            }}
                        />
                    </Inline>
                    <FailureToast
                        failure={refused}
                        testID="feedback-showcase-refused"
                        title="Couldn't save the price list"
                        body={refused?.message}
                    />
                </Stack>

                <Stack space="sm">
                    <Text variant="label">Undo, in place beside the rows</Text>
                    <UndoBar
                        testID="feedback-showcase-undo"
                        label="Row removed"
                        onUndo={() => undefined}
                    />
                </Stack>
            </Stack>

            {/* Beside the content, as in the kitchen, so it sticks to the foot of the page. */}
            <SaveBarSlot />

            <Dialog
                look="card"
                testID="feedback-showcase-dialog"
                open={confirming}
                onClose={() => {
                    setConfirming(false);
                }}
                title="Archive Basmati rice?"
                description="3 recipes use it. They keep working until you swap it out."
                actions={
                    <>
                        <DeskButton
                            variant="secondary"
                            label="Back"
                            onPress={() => {
                                setConfirming(false);
                            }}
                        />
                        <DeskButton
                            variant="danger"
                            label="Archive"
                            onPress={() => {
                                setConfirming(false);
                                toast.show({
                                    undo: true,
                                    message: 'Basmati rice archived',
                                    durationMs: 6000,
                                    action: { label: 'Undo', onPress: () => undefined },
                                });
                            }}
                        />
                    </>
                }
            />
        </View>
    );
}
