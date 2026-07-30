/**
 * `@healthy360/design-system` — the 23 Phase 1 components (plan §19,
 * `docs/architecture/05-universal-frontend.md` §7).
 *
 * Two standing rules, both enforced by tests in this package:
 *
 * 1. **Logical utilities only.** Direction-sensitive spacing, padding, borders and alignment are
 *    expressed as `ms`/`me`, `ps`/`pe`, `start`/`end`, `border-s`/`border-e`, `text-start`/
 *    `text-end`. Physical utilities and NativeWind's `rtl:`/`ltr:` variants are banned by the root
 *    ESLint config; inline React Native start/end style props do not re-mirror on a live web
 *    direction change (`docs/architecture/notes/nativewind-spike.md` §4).
 * 2. **Meaning is never carried by colour alone.** Every semantic tone pairs its colour with an
 *    icon or a pattern.
 */

export { cx } from './internal/class-names.ts';
export { describedBy, descriptionProps, slotId } from './internal/a11y.ts';
export type { DescriptionProps } from './internal/a11y.ts';

export { useTheme } from './hooks/use-theme.ts';
export type { UseThemeResult } from './hooks/use-theme.ts';
export { BREAKPOINT_ORDER, useBreakpoint } from './hooks/use-breakpoint.ts';
export type { Breakpoint, UseBreakpointResult } from './hooks/use-breakpoint.ts';
export { useReducedMotion } from './hooks/use-reduced-motion.ts';

export { DIRECTIONAL_ICON_NAMES, ICON_GLYPHS, ICON_SIZES, Icon, resolveIconGlyph } from './icons/icon.tsx';
export type { DirectionalIconName, IconGlyphName, IconName, IconProps, IconSize } from './icons/icon.tsx';

export { HEADING_LEVELS, Heading, TEXT_ALIGNMENTS, TEXT_TONES, TEXT_VARIANTS, Text } from './primitives/text.tsx';
export type {
    HeadingLevel,
    HeadingProps,
    TextAlignment,
    TextProps,
    TextTone,
    TextVariant,
} from './primitives/text.tsx';

export { ALIGNMENTS, Inline, JUSTIFICATIONS, SPACE_STEPS, Stack } from './primitives/stack.tsx';
export type { Alignment, InlineProps, Justification, SpaceStep, StackProps } from './primitives/stack.tsx';

export { BUTTON_SIZES, BUTTON_VARIANTS, Button, IconButton } from './actions/button.tsx';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './actions/button.tsx';

export { FormField, REQUIRED_MARK } from './forms/form-field.tsx';
export type { FieldControlProps, FormFieldProps } from './forms/form-field.tsx';
export { TextInputField, inputFrameClassName } from './forms/text-input.tsx';
export type { TextInputFieldProps } from './forms/text-input.tsx';
export { PasswordInput } from './forms/password-input.tsx';
export type { PasswordInputProps } from './forms/password-input.tsx';
export { Checkbox } from './forms/checkbox.tsx';
export type { CheckboxProps } from './forms/checkbox.tsx';
export { Select } from './forms/select.tsx';
export type { SelectOption, SelectProps } from './forms/select.tsx';

export { CARD_PADDINGS, CARD_TONES, Card } from './content/card.tsx';
export type { CardPadding, CardProps, CardTone } from './content/card.tsx';
export { ListItem } from './content/list-item.tsx';
export type { ListItemProps } from './content/list-item.tsx';
export { BADGE_TONES, Badge, NUTRITION_LEVELS } from './content/badge.tsx';
export type { BadgeProps, BadgeTone, NutritionLevel } from './content/badge.tsx';

export { SPINNER_SIZES, Spinner } from './status/spinner.tsx';
export type { SpinnerProps, SpinnerSize } from './status/spinner.tsx';
export { Skeleton } from './status/skeleton.tsx';
export type { SkeletonProps } from './status/skeleton.tsx';
export { EMPTY_STATE_VARIANTS, EmptyState } from './status/empty-state.tsx';
export type { EmptyStateProps, EmptyStateVariant } from './status/empty-state.tsx';
export { ErrorState, FAILURE_MESSAGE_KEYS } from './status/error-state.tsx';
export type { ErrorStateProps } from './status/error-state.tsx';
export { CONNECTIVITY_STATES, OfflineIndicator } from './status/offline-indicator.tsx';
export type { ConnectivityState, OfflineIndicatorProps } from './status/offline-indicator.tsx';

export { Dialog } from './overlays/dialog.tsx';
export type { DialogProps } from './overlays/dialog.tsx';
export { Drawer } from './overlays/drawer.tsx';
export type { DrawerProps } from './overlays/drawer.tsx';
export { DEFAULT_TOAST_DURATION_MS, TOAST_TONES, ToastProvider, useToast } from './overlays/toast.tsx';
export type { Toast, ToastApi, ToastOptions, ToastProviderProps, ToastTone } from './overlays/toast.tsx';

export { APP_SHELL_VARIANTS, AppShell } from './shell/app-shell.tsx';
export type { AppShellProps, AppShellVariant, NavigationItem } from './shell/app-shell.tsx';
