import { screen } from '@testing-library/react-native';

import { assertSubtreeIsLogical, renderWithI18n } from '../testing/render.tsx';
import { ICON_GLYPHS, Icon, resolveIconGlyph } from './icon.tsx';

describe('resolveIconGlyph', () => {
    it('mirrors the directional chevrons by swapping the character, not a style', () => {
        expect(resolveIconGlyph('chevronEnd', false)).toBe(ICON_GLYPHS.chevronForward);
        expect(resolveIconGlyph('chevronEnd', true)).toBe(ICON_GLYPHS.chevronBackward);
        expect(resolveIconGlyph('chevronStart', false)).toBe(ICON_GLYPHS.chevronBackward);
        expect(resolveIconGlyph('chevronStart', true)).toBe(ICON_GLYPHS.chevronForward);
    });

    it('leaves non-directional icons alone in both directions', () => {
        for (const isRtl of [false, true]) {
            expect(resolveIconGlyph('check', isRtl)).toBe(ICON_GLYPHS.check);
            expect(resolveIconGlyph('menu', isRtl)).toBe(ICON_GLYPHS.menu);
        }
    });

    it('has a distinct glyph for every name', () => {
        const glyphs = Object.values(ICON_GLYPHS);
        expect(new Set(glyphs).size).toBe(glyphs.length);
    });
});

describe('Icon', () => {
    it('is hidden from assistive technology when it has no label', async () => {
        await renderWithI18n(<Icon testID="decorative" name="check" />);
        const node = screen.getByTestId('decorative');

        expect(node.props['aria-hidden']).toBe(true);
        expect(node.props.accessibilityElementsHidden).toBe(true);
        expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
        expect(node.props.accessibilityLabel).toBeUndefined();
    });

    it('becomes an image with a name when it carries the meaning itself', async () => {
        await renderWithI18n(<Icon testID="meaningful" name="warning" label="Suspended" />);
        const node = screen.getByTestId('meaningful');

        expect(node.props['aria-hidden']).toBe(false);
        expect(node.props.accessibilityRole).toBe('image');
        expect(node.props.accessibilityLabel).toBe('Suspended');
    });

    it('renders the forward chevron in English', async () => {
        await renderWithI18n(<Icon testID="chev" name="chevronEnd" />, 'en');
        expect(screen.getByTestId('chev')).toHaveTextContent(ICON_GLYPHS.chevronForward);
    });

    it('renders the backward chevron in Arabic', async () => {
        await renderWithI18n(<Icon testID="chev" name="chevronEnd" />, 'ar');
        expect(screen.getByTestId('chev')).toHaveTextContent(ICON_GLYPHS.chevronBackward);
    });

    it('uses no physical direction utility', async () => {
        await renderWithI18n(<Icon testID="logical" name="chevronEnd" />);
        assertSubtreeIsLogical(screen.getByTestId('logical'));
    });
});
