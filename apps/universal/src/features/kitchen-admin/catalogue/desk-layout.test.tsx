import { screen } from '@testing-library/react-native';
import { ContentWidthProvider } from '@healthy360/design-system';
import { Text } from 'react-native';

import { renderStubScreen } from '../../../testing/stub-screen.tsx';
import { RecordViewPage } from './record-view-page.tsx';
import { getRecordAction } from '../../../testing/record-actions.ts';

/*
 * The admin on a laptop. A 1920×1080 panel at 150% scaling hands the browser 1280px, and the shell's
 * rail, page panel and padding take a large share of that before a page draws anything — so every
 * page here is laid out against the content column the shell reports, never the window.
 */

let mockWindowWidth = 1280;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: mockWindowWidth, height: 720, scale: 1, fontScale: 1 }),
}));

/** The desk shell with its page panel open: 56 rail + 232 panel, 28px padding a side. */
const PANEL_OPEN = { chrome: 288, padding: 28 };
/** The same shell with the panel shut — what a laptop opens on. */
const PANEL_SHUT = { chrome: 56, padding: 28 };

describe('RecordViewPage as a pop-up', () => {
    const page = (
        <RecordViewPage
            testID="record"
            title="Tahini paste"
            kind="Ingredient"
            onBack={() => undefined}
            fields={[{ key: 'reference', label: 'Reference', value: 'ING-0142' }]}
            statusLines={['Updated today']}
            statusContent={<Text>Two open recipes use it.</Text>}
            primaryAction={{ label: 'Edit', onPress: () => undefined }}
        />
    );

    it('splits against the window, not the page: two columns in the 880 window', async () => {
        // 1093px with the page panel open leaves the page 749px — one column on a page — but the
        // window is 880 wide whatever the page behind it has.
        mockWindowWidth = 1093;
        await renderStubScreen(
            <ContentWidthProvider value={PANEL_OPEN}>{page}</ContentWidthProvider>,
        );

        expect(screen.getByTestId('record-body').props.className).toContain('flex-row');
        expect(screen.getByTestId('record-eyebrow')).toHaveTextContent('Ingredient');
    });

    it('stacks where the window itself is narrow', async () => {
        mockWindowWidth = 800;
        await renderStubScreen(
            <ContentWidthProvider value={PANEL_SHUT}>{page}</ContentWidthProvider>,
        );

        expect(screen.getByTestId('record-body').props.className).not.toContain('flex-row');
    });

    it('pins the primary in the desk footer and draws no button on the canopy', async () => {
        mockWindowWidth = 1280;
        await renderStubScreen(
            <ContentWidthProvider value={PANEL_SHUT}>{page}</ContentWidthProvider>,
        );

        expect(screen.queryByTestId('record-back')).toBeNull();
        const primary = await getRecordAction('record', 'record-primary');
        expect(screen.getByTestId('record-header')).not.toContainElement(primary);
        expect(screen.getByTestId('record-footer')).toContainElement(primary);
        expect(screen.getByTestId('record-close')).toBeTruthy();
    });
});
