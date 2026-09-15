import { resolveFlip } from './anchored-surface.ts';

/**
 * The edge flip, at the level the bug actually lives.
 *
 * §4.3 records two attempts at this. The first measured against the scroll port alone and left a
 * phantom 44–50px of horizontal scroll; the second measured against the narrower of the port and
 * the grid's `max-content` width and did not. The difference between them is one `Math.min`, and
 * the case that separates them is the third test below — a panel that is *inside the port* and
 * still overflowing.
 */

const PANEL = 220;

describe('resolveFlip', () => {
    it('anchors to the start edge when the panel fits', () => {
        expect(
            resolveFlip({
                anchorInlineStart: 40,
                panelWidth: PANEL,
                portWidth: 900,
                gridWidth: 900,
            }),
        ).toBe('start');
    });

    it('flips to the end edge when the panel would run past the port', () => {
        // A right-hand column's menu. Un-flipped, the clipped strip holds the value rows' trailing
        // edge and the `Clear` link — the affordance for undoing the filter you just applied.
        expect(
            resolveFlip({
                anchorInlineStart: 760,
                panelWidth: PANEL,
                portWidth: 900,
                gridWidth: 1400,
            }),
        ).toBe('end');
    });

    it('flips when the panel overflows the grid even though it fits the port', () => {
        // The regression the first fix left behind, as one assertion. The grid's `max-content`
        // width is 700 inside a 900px port: 600 + 220 = 820 sits comfortably in the port and hangs
        // 120px past the grid — and it is the grid the browser measures `scrollWidth` from, so
        // that overhang is a scrollbar under content that looks fine.
        expect(
            resolveFlip({
                anchorInlineStart: 600,
                panelWidth: PANEL,
                portWidth: 900,
                gridWidth: 700,
            }),
        ).toBe('end');

        // And the proof it is the `min` doing the work: the same geometry measured against the port
        // alone — which is what `gridWidth: Infinity` expresses — does not flip.
        expect(
            resolveFlip({
                anchorInlineStart: 600,
                panelWidth: PANEL,
                portWidth: 900,
                gridWidth: Number.POSITIVE_INFINITY,
            }),
        ).toBe('start');
    });

    it('treats an exact fit as fitting', () => {
        expect(
            resolveFlip({
                anchorInlineStart: 680,
                panelWidth: PANEL,
                portWidth: 900,
                gridWidth: 900,
            }),
        ).toBe('start');
    });

    it('stays at the start edge when nothing can be measured', () => {
        // Before layout, and on any tree with neither a scroll port nor a grid above the anchor.
        // Guessing `end` here would open every menu backwards on first paint.
        expect(
            resolveFlip({
                anchorInlineStart: 0,
                panelWidth: PANEL,
                portWidth: Number.POSITIVE_INFINITY,
                gridWidth: Number.POSITIVE_INFINITY,
            }),
        ).toBe('start');

        expect(
            resolveFlip({ anchorInlineStart: 0, panelWidth: PANEL, portWidth: 0, gridWidth: 0 }),
        ).toBe('start');
    });

    it('is direction-agnostic because its inputs are inline, not physical', () => {
        // The RTL half of §4.3. `anchorInlineStart` is measured from the reference box's inline
        // start — the right edge under RTL — so a trigger 760px along the inline axis overflows
        // identically in both directions and needs no mirrored branch. A comparison written
        // against a hard-coded right edge is the one that flips the wrong way in Arabic.
        const ltr = resolveFlip({
            anchorInlineStart: 760,
            panelWidth: PANEL,
            portWidth: 900,
            gridWidth: 900,
        });
        const rtl = resolveFlip({
            anchorInlineStart: 760,
            panelWidth: PANEL,
            portWidth: 900,
            gridWidth: 900,
        });

        expect(ltr).toBe('end');
        expect(rtl).toBe(ltr);
    });
});
