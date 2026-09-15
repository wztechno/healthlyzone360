import { fieldWidth } from '@healthy360/design-tokens';
import { screen } from '@testing-library/react-native';

import { GRID_GAP, RESPONSIVE_COLUMNS, resolveSpan, spanWidth } from './grid-shared.ts';
import { Separator } from './separator.tsx';
import { renderWithI18n } from '../testing/render.tsx';

/**
 * The no-stretch rule, tested where it can actually be observed.
 *
 * The geometry lives in `grid-shared.ts` and both platform halves spend it, so that is what these
 * assert on — the arithmetic, not a rendered CSS grid. `grid.web.tsx` renders a real `<div>` with a
 * `display: grid` style that jest-expo's renderer has no layout engine for, so asserting "the
 * second field starts at 296px" here would be asserting on a mock. The width a span resolves to,
 * on the other hand, is a number this system commits to, and it is the one a regression would move.
 */

describe('grid geometry', () => {
    it('keeps the field width constant across every breakpoint', () => {
        // The rule in one assertion: the ladder moves the column *count*, and nothing in it is a
        // width. If a breakpoint ever gains a width this fails, which is the point.
        expect(Object.values(RESPONSIVE_COLUMNS)).toEqual([1, 2, 3]);
        expect(fieldWidth).toBe(280);
    });

    it('resolves an unstated span to a single column', () => {
        expect(resolveSpan(3, {})).toBe(1);
    });

    it('clamps a span to the columns that exist', () => {
        // The phone case, and the reason `span` is a request rather than an instruction: a
        // `span={3}` textarea in a one-column layout is one column wide, not three.
        expect(resolveSpan(1, { span: 3 })).toBe(1);
        expect(resolveSpan(2, { span: 3 })).toBe(2);
        expect(resolveSpan(3, { span: 2 })).toBe(2);
    });

    it('treats fullWidth as the declared column count', () => {
        expect(resolveSpan(3, { fullWidth: true })).toBe(3);
        expect(resolveSpan(1, { fullWidth: true })).toBe(1);
    });

    it('floors a fractional or zero span at one column', () => {
        expect(resolveSpan(3, { span: 0 })).toBe(1);
        expect(resolveSpan(3, { span: -2 })).toBe(1);
        expect(resolveSpan(3, { span: 1.8 })).toBe(1);
    });

    it('adds the swallowed gap when a span crosses a track boundary', () => {
        // 280 + 16 + 280. A span that forgot the gap would leave a 16px hole in every wide field,
        // which is the arithmetic a utility class cannot do and the reason this helper exists.
        expect(spanWidth(1)).toBe(fieldWidth);
        expect(spanWidth(2)).toBe(fieldWidth * 2 + GRID_GAP.column);
        expect(spanWidth(3)).toBe(fieldWidth * 3 + GRID_GAP.column * 2);
    });
});

describe('Separator', () => {
    it('draws a hairline at separator weight, never at control weight', async () => {
        await renderWithI18n(<Separator testID="rule" />);
        const className = screen.getByTestId('rule').props.className;

        expect(className).toContain('border-stroke-subtle');
        expect(className).not.toContain('border-stroke-strong');
    });

    it('is hidden from assistive technology by default', async () => {
        await renderWithI18n(<Separator testID="rule" />);
        expect(screen.getByTestId('rule').props['aria-hidden']).toBe(true);
    });

    it('announces itself only when asked to be semantic', async () => {
        await renderWithI18n(<Separator testID="semantic" semantic />);
        expect(screen.getByTestId('semantic').props.role).toBe('separator');
        expect(screen.getByTestId('semantic').props['aria-hidden']).toBeUndefined();
    });

    it('uses a logical border for the vertical orientation', async () => {
        await renderWithI18n(<Separator testID="rule" orientation="vertical" />);
        const className = screen.getByTestId('rule').props.className as string;

        expect(className).toContain('border-e');
        expect(className).not.toMatch(/border-[lr](\s|$)/);
    });
});
