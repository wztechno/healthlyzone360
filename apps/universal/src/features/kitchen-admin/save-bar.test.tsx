import { act, fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Pressable, Text as RNText } from 'react-native';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { SaveBarProvider, SaveBarSlot, useSaveBar } from './save-bar.tsx';

/** An editor in miniature: a value it was loaded with, and what the reader changed it to. */
function Editor({ onSave }: { readonly onSave: () => void }) {
    const [value, setValue] = useState('saved');
    const drawn = useSaveBar({
        dirty: value !== 'saved',
        save: { testID: 'editor-save', label: 'Save', onPress: onSave },
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
    it('shows while there are changes, with Save and no Discard', async () => {
        const save = jest.fn();
        await renderStubScreen(
            <SaveBarProvider>
                <Editor onSave={save} />
                <SaveBarSlot />
            </SaveBarProvider>,
            { session: kitchenManagerSession() },
        );

        expect(screen.getByTestId('editor-drawn')).toHaveTextContent('bar');
        expect(screen.queryByTestId('editor-save-bar')).toBeNull();

        await press('editor-change');
        expect(screen.getByTestId('editor-save-bar-status')).toHaveTextContent(/Unsaved changes/);
        // Cancel is how unsaved work is dropped; the bar offers only the commit.
        expect(screen.queryByTestId('editor-discard')).toBeNull();

        await press('editor-save');
        expect(save).toHaveBeenCalledTimes(1);
    });

    it('is not drawn outside the kitchen layout, so the editor keeps its own Save', async () => {
        await renderStubScreen(<Editor onSave={() => undefined} />, {
            session: kitchenManagerSession(),
        });
        expect(screen.getByTestId('editor-drawn')).toHaveTextContent('own');
    });
});
