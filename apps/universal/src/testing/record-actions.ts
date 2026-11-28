import { fireEvent, screen } from '@testing-library/react-native';

type Found = NonNullable<ReturnType<typeof screen.queryByTestId>>;

/**
 * A record pop-up's actions live behind its ⋯ (`RecordDialog`, `-actions`), so a suite that used
 * to press a canopy or tile button opens the menu first. Opening is idempotent: an item already
 * listed is returned as it is, and a pop-up with no ⋯ (no actions at all) answers `null`.
 */
export async function queryRecordAction(view: string, action: string): Promise<Found | null> {
    const listed = screen.queryByTestId(action);
    if (listed !== null) return listed;
    const trigger = screen.queryByTestId(`${view}-actions`);
    if (trigger === null) return null;
    // Pressed only while shut: the trigger toggles, and a retry must not close an open menu.
    if (screen.queryByTestId(`${view}-actions-menu-panel`) === null) await fireEvent.press(trigger);
    return screen.queryByTestId(action);
}

export async function getRecordAction(view: string, action: string): Promise<Found> {
    const found = await queryRecordAction(view, action);
    if (found === null) {
        throw new Error(`No ${action} behind the ⋯ of ${view}.`);
    }
    return found;
}

/** Opens the record's ⋯ and presses one of its actions. */
export async function pressRecordAction(view: string, action: string): Promise<void> {
    await fireEvent.press(await getRecordAction(view, action));
}
