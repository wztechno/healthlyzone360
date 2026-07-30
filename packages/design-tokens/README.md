# @healthy360/design-tokens

The styling-engine-agnostic source of truth for Healthy360's visual language, written as plain
TypeScript: a desaturated teal-green brand ramp, a warm clay accent, warm neutrals, semantic
success/warning/danger/info sets that always ship a background *and* its legible `on*` foreground, a
five-stop nutrition scale where **every stop carries a pattern token as well as a colour** so meaning
is never conveyed by colour alone, per-script typography (Inter for Latin, IBM Plex Sans Arabic, with
1.5 / 1.75 line-height multipliers because Arabic needs the room), a 4-point spacing scale, radii, six
elevation levels emitted as both React Native shadow objects and CSS `box-shadow` strings, motion
durations with zeroed reduced-motion counterparts, and breakpoints. Three committed artefacts are
generated from that source by `pnpm build:tokens` — `generated/tailwind-preset.cjs`,
`generated/tokens.css` and `generated/tokens.native.ts` — with a drift test that fails if they and the
source disagree. The test suite is the accessibility budget: every semantic foreground/background pair
in both themes is asserted at WCAG AA (≥4.5:1) using a relative-luminance implementation this package
owns, and every ramp is asserted monotonic.
