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
export { POINTER_KINDS, useIsCoarsePointer, usePointerKind } from './hooks/use-pointer.ts';
export type { PointerKind } from './hooks/use-pointer.ts';

export {
    DIRECTIONAL_ICON_NAMES,
    ICON_GLYPHS,
    ICON_SIZES,
    Icon,
    resolveIconGlyph,
} from './icons/icon.tsx';
export type {
    DirectionalIconName,
    IconGlyphName,
    IconName,
    IconProps,
    IconSize,
} from './icons/icon.tsx';

export {
    HEADING_LEVELS,
    Heading,
    TEXT_ALIGNMENTS,
    TEXT_TONES,
    TEXT_VARIANTS,
    Text,
} from './primitives/text.tsx';
export type {
    HeadingLevel,
    HeadingProps,
    TextAlignment,
    TextProps,
    TextTone,
    TextVariant,
} from './primitives/text.tsx';

export { ALIGNMENTS, Inline, JUSTIFICATIONS, SPACE_STEPS, Stack } from './primitives/stack.tsx';
export type {
    Alignment,
    InlineProps,
    Justification,
    SpaceStep,
    StackProps,
} from './primitives/stack.tsx';

export { BUTTON_SIZES, BUTTON_VARIANTS, Button, IconButton } from './actions/button.tsx';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './actions/button.tsx';

export { FormField, REQUIRED_MARK } from './forms/form-field.tsx';
export type { FieldControlProps, FormFieldProps } from './forms/form-field.tsx';
export { TextInputField, inputControlClassName, inputFrameClassName } from './forms/text-input.tsx';
export type { TextInputFieldProps } from './forms/text-input.tsx';
export { PasswordInput } from './forms/password-input.tsx';
export type { PasswordInputProps } from './forms/password-input.tsx';
export { OtpInput, normaliseOtpDigits } from './forms/otp-input.tsx';
export type { OtpInputProps } from './forms/otp-input.tsx';
export {
    FILE_UPLOAD_MAX_BYTES,
    FILE_UPLOAD_MIME_TYPES,
    FILE_UPLOAD_REJECTIONS,
    FileUploadField,
} from './forms/file-upload-field.tsx';
export type {
    FileUploadFieldProps,
    FileUploadRejection,
    PickedFile,
} from './forms/file-upload-field.tsx';
export { Checkbox } from './forms/checkbox.tsx';
export type { CheckboxProps } from './forms/checkbox.tsx';
export { Select } from './forms/select.tsx';
export type { SelectOption, SelectProps } from './forms/select.tsx';
export { NumberStepper, clampToStep } from './forms/number-stepper.tsx';
export type { NumberStepperProps } from './forms/number-stepper.tsx';
export { RangeFilter, isInvertedRange } from './forms/range-filter.tsx';
export type { RangeFilterProps, RangeValue } from './forms/range-filter.tsx';
/**
 * Extensionless on purpose — this is the one import in the package that Metro must resolve per
 * platform (`date-field.web.tsx` / `date-field.native.tsx`). Everything both halves share is
 * exported from `date-field-shared.ts`, which is platform-neutral.
 */
export { DateField } from './forms/date-field';
export type { DateFieldProps } from './forms/date-field';
export {
    daysInMonth,
    isIsoDate,
    isoFromParts,
    monthNames,
    partsFromIso,
    yearRange,
} from './forms/date-field-shared.ts';
export type { DateParts } from './forms/date-field-shared.ts';

export { CARD_PADDINGS, CARD_TONES, Card } from './content/card.tsx';
export type { CardPadding, CardProps, CardTone } from './content/card.tsx';
export { ListItem } from './content/list-item.tsx';
export type { ListItemProps } from './content/list-item.tsx';
export { BADGE_TONES, Badge, NUTRITION_LEVELS } from './content/badge.tsx';
export type { BadgeProps, BadgeTone, NutritionLevel } from './content/badge.tsx';
export { CHIP_TONES, Chip, FilterChip } from './content/chip.tsx';
export type { ChipProps, ChipTone, FilterChipProps } from './content/chip.tsx';
export { CALLOUT_ROLES, CALLOUT_TONES, Callout } from './content/callout.tsx';
export type { CalloutProps, CalloutRole, CalloutTone } from './content/callout.tsx';
export { Accordion } from './content/accordion.tsx';
export type { AccordionItem, AccordionProps } from './content/accordion.tsx';
export {
    AVATAR_SIZES,
    Avatar,
    IMAGE_PLACEHOLDER_ASPECTS,
    ImagePlaceholder,
    initialsFrom,
    seedHash,
} from './content/avatar.tsx';
export type {
    AvatarProps,
    AvatarSize,
    ImagePlaceholderAspect,
    ImagePlaceholderProps,
} from './content/avatar.tsx';

export { SegmentedControl, TABS_VARIANTS, Tabs } from './navigation/tabs.tsx';
export type { SegmentedControlProps, TabItem, TabsProps, TabsVariant } from './navigation/tabs.tsx';
export { Stepper } from './navigation/stepper.tsx';
export type { StepperProps } from './navigation/stepper.tsx';
export { BREADCRUMB_TONES, Breadcrumbs } from './navigation/breadcrumbs.tsx';
export type {
    BreadcrumbItem,
    BreadcrumbTone,
    BreadcrumbsProps,
} from './navigation/breadcrumbs.tsx';

export { Table } from './data/table.tsx';
export type { TableColumn, TableProps, TableRowAction, TableSortDirection } from './data/table.tsx';
export { CalendarGrid } from './data/calendar-grid.tsx';
export type {
    CalendarCell,
    CalendarDay,
    CalendarGridProps,
    CalendarSlot,
} from './data/calendar-grid.tsx';
export { MeterBar, PROGRESS_RING_SIZES, ProgressRing } from './data/progress.tsx';
export type { MeterBarProps, ProgressRingProps, ProgressRingSize } from './data/progress.tsx';
export { RATING_SIZES, RATING_VARIANTS, Rating } from './data/rating.tsx';
export type { RatingProps, RatingSize, RatingVariant } from './data/rating.tsx';

export { SPINNER_SIZES, Spinner } from './status/spinner.tsx';
export type { SpinnerProps, SpinnerSize } from './status/spinner.tsx';
export { SKELETON_VARIANTS, Skeleton } from './status/skeleton.tsx';
export type { SkeletonProps, SkeletonVariant } from './status/skeleton.tsx';
export { EMPTY_STATE_VARIANTS, EmptyState } from './status/empty-state.tsx';
export type { EmptyStateProps, EmptyStateVariant } from './status/empty-state.tsx';
export { ErrorState, FAILURE_MESSAGE_KEYS } from './status/error-state.tsx';
export type { ErrorStateProps } from './status/error-state.tsx';
export { CONNECTIVITY_STATES, OfflineIndicator } from './status/offline-indicator.tsx';
export type { ConnectivityState, OfflineIndicatorProps } from './status/offline-indicator.tsx';

export { Dialog } from './overlays/dialog.tsx';
export type { DialogProps } from './overlays/dialog.tsx';
export { DRAWER_PLACEMENTS, Drawer } from './overlays/drawer.tsx';
export type { DrawerPlacement, DrawerProps } from './overlays/drawer.tsx';
export { ACTION_TONES, ActionSheet } from './overlays/action-sheet.tsx';
export type { ActionSheetAction, ActionSheetProps, ActionTone } from './overlays/action-sheet.tsx';
export { POPOVER_TRIGGERS, Popover } from './overlays/popover.tsx';
export type { PopoverProps, PopoverTrigger } from './overlays/popover.tsx';
export {
    DEFAULT_TOAST_DURATION_MS,
    TOAST_TONES,
    ToastProvider,
    useToast,
} from './overlays/toast.tsx';
export type {
    Toast,
    ToastApi,
    ToastOptions,
    ToastProviderProps,
    ToastTone,
} from './overlays/toast.tsx';

export { APP_SHELL_VARIANTS, AppShell } from './shell/app-shell.tsx';
export type { AppShellProps, AppShellVariant, NavigationItem } from './shell/app-shell.tsx';

export { MAX_STAGGERED_ITEMS, STAGGER_STEP_MS, useMotion } from './motion/use-motion.ts';
export type { MotionTokens } from './motion/use-motion.ts';
export { FadeIn } from './motion/fade-in.tsx';
export type { FadeInProps } from './motion/fade-in.tsx';
export { SLIDE_EDGES, SlideIn } from './motion/slide-in.tsx';
export type { SlideEdge, SlideInProps } from './motion/slide-in.tsx';
export { Collapse } from './motion/collapse.tsx';
export type { CollapseProps } from './motion/collapse.tsx';
export { Shimmer } from './motion/shimmer.tsx';
export type { ShimmerProps } from './motion/shimmer.tsx';
export { useAnimatedNumber } from './motion/use-animated-number.ts';
export type { UseAnimatedNumberOptions } from './motion/use-animated-number.ts';
export { PageTransition } from './motion/page-transition.tsx';
export type { PageTransitionProps } from './motion/page-transition.tsx';
