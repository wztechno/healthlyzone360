import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text as RNText } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import {
    DiscardBoundary,
    SaveBarProvider,
    SaveBarSlot,
    useBeforeDiscard,
    useSaveBar,
} from './save-bar.tsx';

/** An editor in miniature: a value it was loaded with, and what the reader changed it to. */
function Editor({ onBeforeDiscard }: { readonly onBeforeDiscard: () => void }) {
    const [value, setValue] = useState('saved');
    useBeforeDiscard(onBeforeDiscard);
    const drawn = useSaveBar({
        dirty: value !== 'saved',
        save: { testID: 'editor-save', label: 'Save', onPress: () => undefined },
        testID: 'editor',
    });
    return (
        <>
            <RNText testID="editor-value">{value}</RNText>
            <RNText testID="editor-drawn">{drawn ? 'bar' : 'own'}</RNText>
            <Pressable
                testID="editor-change"
                onPress={() => {
                    setValue('changed');
                }}
            />
        </>
    );
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

describe('the save bar', () => {
    it('shows while there are changes, and its Discard puts the page back after asking', async () => {
        const before = jest.fn();
        await renderStubScreen(
            <SaveBarProvider>
                <DiscardBoundary>
                    <Editor onBeforeDiscard={before} />
                </DiscardBoundary>
                <SaveBarSlot />
            </SaveBarProvider>,
            { session: kitchenManagerSession() },
        );

        expect(screen.getByTestId('editor-drawn')).toHaveTextContent('bar');
        expect(screen.queryByTestId('editor-save-bar')).toBeNull();

        await press('editor-change');
        expect(screen.getByTestId('editor-save-bar-status')).toHaveTextContent(/Unsaved changes/);
        expect(screen.getByTestId('editor-save')).toBeTruthy();

        // Asks first; Keep editing changes nothing.
        await press('editor-discard');
        await press('editor-discard-keep');
        expect(screen.getByTestId('editor-value')).toHaveTextContent('changed');
        expect(before).not.toHaveBeenCalled();

        await press('editor-discard');
        await press('editor-discard-confirm');
        // Drafts are dropped first, then the page is drawn afresh from what was saved.
        expect(before).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('editor-value')).toHaveTextContent('saved');
        expect(screen.queryByTestId('editor-save-bar')).toBeNull();
    });

    it('is not drawn outside the kitchen layout, so the editor keeps its own Save', async () => {
        await renderStubScreen(<Editor onBeforeDiscard={() => undefined} />, {
            session: kitchenManagerSession(),
        });
        expect(screen.getByTestId('editor-drawn')).toHaveTextContent('own');
    });
});
