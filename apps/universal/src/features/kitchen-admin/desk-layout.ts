/**
 * Where the kitchen admin's pages change shape, measured against the **content column**
 * (`useContentWidth`), never the window.
 *
 * The admin is a desk surface, and the desks it runs on are laptops as often as monitors: a
 * 1920×1080 panel at 150% scaling hands the browser 1280px, and a 1366×768 one at 125% hands it
 * 1093. Window breakpoints read those as "wide" while the shell's rail and padding have already
 * spent a large share of them, so every split here is stated as the room its columns need.
 *
 * Each threshold leaves ~20px over the sum of its columns for a scrollbar the shell cannot see.
 */

/**
 * A record page's two columns, side by side: the main column at ~560 beside a 300px rail and the
 * 16px gap between them. Below it the page is one column, with the record's status card — the one
 * that carries its primary action — first.
 */
export const RECORD_SPLIT_MIN = 880;

/** The record rail's floor beside the main column. Narrower and its status lines wrap per word. */
export const RECORD_RAIL_MIN = 300;

/**
 * The narrowest a form column may be with an editor rail beside it. Two `md` fields side by side
 * and a label column still read at this width; below it the rail moves under the form.
 */
export const EDITOR_FORM_MIN = 520;
