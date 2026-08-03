import type {
    B2BApplication,
    B2BApplicationSection,
    B2BApplicationSectionState,
    B2BApplicationSections,
    B2BDocumentKind,
} from '@healthy360/api-client/contracts';
import { z } from 'zod';

/**
 * The wizard's steps, their per-step validation, and the reachability rule the router redirects on.
 *
 * The shape is lifted from `features/onboarding/steps.ts`, which earned it: **the slug is the
 * route** (`/apply/company`, not `/apply/1`, so a bookmark survives an inserted step) and **the
 * order lives here and nowhere else** (progress, back, next, the review screen's edit links and the
 * deep-link redirect all read the same array — a second ordering in a switch statement is how a
 * wizard becomes reachable in one direction and not the other).
 *
 * Two things differ from the onboarding wizard, and both matter.
 *
 * **The answers are not here.** There is no reducer and no local draft: every step saves to the
 * server (`data/b2b-application-hooks.ts`). This module is validation and navigation only.
 *
 * **Completeness is the server's answer.** {@link isStepComplete} reads
 * `B2BApplicationSectionState.complete` — the *server's* readiness verdict — rather than re-running
 * the schemas over the data. The schemas exist to stop a bad value being *sent*; they are not a
 * second opinion about whether the application is ready, because the server's rule is the one that
 * decides and a client that disagreed would either block a valid submission or promise an invalid
 * one.
 */

/* ── the steps ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The six steps, in order.
 *
 * Four are sections (the sheet-4 field groups the server PATCHes one at a time); `documents` and
 * `review` are steps that are **not** sections, exactly as the backend has it — a document has its
 * own lifecycle and its own review, and folding it into a field group would put a text-box PATCH and
 * a passport upload on one code path.
 */
export const B2B_STEP_SLUGS = [
    'company',
    'signatory',
    'trade-terms',
    'logistics',
    'documents',
    'review',
] as const;
export type B2BStepSlug = (typeof B2B_STEP_SLUGS)[number];

export const FIRST_B2B_STEP: B2BStepSlug = 'company';

/** Slug → section, for the four steps that write one. `null` for `documents` and `review`. */
const SECTION_BY_SLUG: Readonly<Record<B2BStepSlug, B2BApplicationSection | null>> = {
    company: 'company',
    signatory: 'signatory',
    'trade-terms': 'trade_terms',
    logistics: 'logistics',
    documents: null,
    review: null,
};

/** The inverse, for a reviewer request that names a section and needs somewhere to link. */
const SLUG_BY_SECTION: Readonly<Record<B2BApplicationSection, B2BStepSlug>> = {
    company: 'company',
    signatory: 'signatory',
    trade_terms: 'trade-terms',
    logistics: 'logistics',
};

export function sectionForStep(slug: B2BStepSlug): B2BApplicationSection | null {
    return SECTION_BY_SLUG[slug];
}

export function stepForSection(section: B2BApplicationSection): B2BStepSlug {
    return SLUG_BY_SECTION[section];
}

export function isB2BStepSlug(value: string | undefined): value is B2BStepSlug {
    return value !== undefined && (B2B_STEP_SLUGS as readonly string[]).includes(value);
}

export interface B2BStepDescriptor {
    readonly slug: B2BStepSlug;
    /** One-based position, for "Step 3 of 6". */
    readonly position: number;
    readonly section: B2BApplicationSection | null;
}

export const B2B_STEPS: readonly B2BStepDescriptor[] = B2B_STEP_SLUGS.map((slug, index) => ({
    slug,
    position: index + 1,
    section: SECTION_BY_SLUG[slug],
}));

export const B2B_STEP_COUNT = B2B_STEPS.length;

export function stepAfter(slug: B2BStepSlug): B2BStepSlug | null {
    const index = B2B_STEP_SLUGS.indexOf(slug);
    return index < 0 || index === B2B_STEP_SLUGS.length - 1
        ? null
        : (B2B_STEP_SLUGS[index + 1] as B2BStepSlug);
}

export function stepBefore(slug: B2BStepSlug): B2BStepSlug | null {
    const index = B2B_STEP_SLUGS.indexOf(slug);
    return index <= 0 ? null : (B2B_STEP_SLUGS[index - 1] as B2BStepSlug);
}

/* ── per-section schemas ──────────────────────────────────────────────────────────────────────── */

/**
 * Empty means "not answered", and that is not an error in a draft.
 *
 * Every optional field goes through this rather than being `.optional()`: a text input hands back
 * `''` when a person clears it, and an `''` written into `legalName` would be a value that looks
 * answered and satisfies nothing. Normalising to `null` at the boundary is what keeps
 * "unanswered" a single representation.
 */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .transform((value) => (value.length === 0 ? null : value))
        .nullable();

/** A field the server requires before submission. Refused empty *at the step*, not only at the end. */
const requiredText = (max: number) => z.string().trim().min(1).max(max);

const optionalUrl = z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine(
        (value) => value === null || /^https?:\/\/\S+$/u.test(value),
        // A website that is not a URL is a field somebody will paste a phone number into.
        { message: 'url' },
    );

const optionalDate = z
    .string()
    .trim()
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/u.test(value), { message: 'date' });

const optionalWholeNumber = (max: number) => z.number().int().min(0).max(max).nullable();

export const companySchema = z.object({
    legalName: requiredText(160),
    legalNameAr: optionalText(160),
    tradingName: optionalText(160),
    businessType: z
        .enum([
            'restaurant',
            'cafe',
            'hotel',
            'catering',
            'retail',
            'corporate_office',
            'school',
            'hospital',
            'gym',
            'other',
        ])
        .nullable(),
    // Two letters, uppercased. Not a country *name*: the server holds a foreign key.
    countryCode: z.string().trim().length(2).toUpperCase(),
    commercialRegistrationNumber: requiredText(60),
    taxRegistrationNumber: optionalText(60),
    incorporatedOn: optionalDate,
    website: optionalUrl,
});

export const signatorySchema = z.object({
    signatoryName: requiredText(120),
    signatoryTitle: requiredText(120),
    // `z.email()` piped rather than `.email()`: zod 4 moved the format checks to top-level
    // schemas, and `packages/validation` already does it this way.
    signatoryEmail: z
        .string()
        .trim()
        .min(1)
        .max(160)
        .pipe(z.email({ error: 'email' })),
    // E.164 shape only, and deliberately no numbering-plan guessing — the same rule J1's phone
    // entry follows (no libphonenumber; a plan check that is wrong about one country is worse
    // than no plan check).
    signatoryPhone: z
        .string()
        .trim()
        .transform((value) => (value.length === 0 ? null : value))
        .nullable()
        .refine((value) => value === null || /^\+[1-9]\d{6,14}$/u.test(value), {
            message: 'phone',
        }),
});

export const tradeTermsSchema = z.object({
    requestedPaymentTerms: z.enum(['prepaid', 'net_15', 'net_30', 'net_60']),
    // In minor units, and a real zero is a real answer ("we will pay up front"), which is why the
    // sentinel for unanswered is `null` rather than 0.
    requestedCreditLimitMinor: optionalWholeNumber(1_000_000_000),
    currencyCode: z
        .string()
        .trim()
        .transform((value) => (value.length === 0 ? null : value.toUpperCase()))
        .nullable()
        .refine((value) => value === null || /^[A-Z]{3}$/u.test(value), { message: 'currency' }),
    expectedVolumeBand: z
        .enum(['under_50', 'from_50_to_200', 'from_200_to_500', 'from_500_to_2000', 'over_2000'])
        .nullable(),
    expectedOrderFrequency: z
        .enum(['daily', 'weekdays', 'weekly', 'fortnightly', 'monthly', 'ad_hoc'])
        .nullable(),
    productCategories: z.array(
        z.enum(['meals', 'meal_plans', 'bulk_catering', 'snacks', 'beverages', 'ingredients']),
    ),
});

export const logisticsSchema = z.object({
    preferredDeliveryWindow: z
        .enum(['early_morning', 'morning', 'afternoon', 'evening'])
        .nullable(),
    leadTimeDays: optionalWholeNumber(365),
    requiresInvoicePerLocation: z.boolean(),
    deliveryNotes: optionalText(2000),
});

export const SECTION_SCHEMAS = {
    company: companySchema,
    signatory: signatorySchema,
    trade_terms: tradeTermsSchema,
    logistics: logisticsSchema,
} as const;

/** Field names that failed, mapped to a message key stem. Empty when the payload is acceptable. */
export type SectionErrors = Readonly<Record<string, string>>;

/**
 * Validate one section's payload.
 *
 * Answers a map of field → reason rather than throwing, because a wizard step draws every error at
 * once: a form that reported the first failure and stopped makes a person fix four fields in four
 * round trips.
 */
export function validateSection(
    section: B2BApplicationSection,
    payload: unknown,
):
    | { readonly ok: true; readonly value: unknown }
    | { readonly ok: false; readonly errors: SectionErrors } {
    const result = SECTION_SCHEMAS[section].safeParse(payload);
    if (result.success) return { ok: true, value: result.data };

    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (typeof field !== 'string' || field in errors) continue;
        // The message is a *key stem*, not copy: `required`, `email`, `url`, `phone`. The screen
        // owns the wording, this module owns the rule.
        errors[field] = issueKey(issue);
    }
    return { ok: false, errors };
}

const MESSAGE_KEYS: ReadonlySet<string> = new Set(['url', 'phone', 'date', 'currency', 'email']);

function issueKey(issue: { readonly code: string; readonly message: string }): string {
    if (MESSAGE_KEYS.has(issue.message)) return issue.message;
    if (issue.code === 'invalid_format') return 'format';
    if (issue.code === 'too_small' || issue.code === 'invalid_type') return 'required';
    if (issue.code === 'too_big') return 'tooLong';
    return 'invalid';
}

/* ── reachability ─────────────────────────────────────────────────────────────────────────────── */

/**
 * Whether a step counts as done.
 *
 * For the four section steps it is the **server's** `complete`, never a re-run of the schemas. For
 * `documents` it is the server's `requiredDocumentKinds` against the documents actually held — also
 * the server's list, never a client constant. `review` is never complete: it is where a person
 * *goes*, not something they finish.
 */
export function isStepComplete(application: B2BApplication, slug: B2BStepSlug): boolean {
    if (slug === 'review') return false;
    if (slug === 'documents') return missingDocumentKinds(application).length === 0;

    const section = SECTION_BY_SLUG[slug];
    if (section === null) return false;
    return sectionState(application, section)?.complete ?? false;
}

export function sectionState(
    application: B2BApplication,
    section: B2BApplicationSection,
): B2BApplicationSectionState | undefined {
    return application.sectionStates.find((state) => state.section === section);
}

/**
 * Required kinds with nothing supplied against them.
 *
 * A `rejected` or `superseded` document does not count — the applicant has to send another — while a
 * `pending` one does: at submission nothing has been reviewed yet, so a rule that only accepted
 * documents satisfied would make submission unreachable.
 */
export function missingDocumentKinds(application: B2BApplication): readonly B2BDocumentKind[] {
    return application.requiredDocumentKinds.filter(
        (kind) =>
            !application.documents.some(
                (held) =>
                    held.kind === kind &&
                    (held.reviewStatus === 'pending' || held.reviewStatus === 'accepted'),
            ),
    );
}

/**
 * The step a bare `/apply` should land on.
 *
 * The first *incomplete* step, not the first step. A person who filled in the company and the
 * signatory yesterday and came back with the trade licence should arrive at what is left, and the
 * alternative — always opening at step one — makes them click past their own answers every time.
 *
 * When everything is done the answer is `review`, which is the honest destination: the work is
 * finished and the remaining action is to send it.
 */
export function firstIncompleteStep(application: B2BApplication): B2BStepSlug {
    for (const step of B2B_STEPS) {
        if (step.slug === 'review') continue;
        if (!isStepComplete(application, step.slug)) return step.slug;
    }
    return 'review';
}

/**
 * Whether the applicant may edit this step at all right now.
 *
 * In `draft`, everything. In `info_requested`, **only what a reviewer reopened** — the sections an
 * unresolved request named, and the documents step whenever any request named a document kind. That
 * narrowing is the whole difference between "we need two things from you" and "here is your form
 * back"; the server enforces it and this is the client agreeing rather than deciding.
 */
export function isStepEditable(application: B2BApplication, slug: B2BStepSlug): boolean {
    if (application.state === 'draft') return true;
    if (application.state !== 'info_requested') return false;

    if (slug === 'documents') {
        return application.reviewerRequests.some(
            (request) => request.resolvedAt === null && request.documentKinds.length > 0,
        );
    }
    if (slug === 'review') return true;

    const section = SECTION_BY_SLUG[slug];
    return section !== null && (sectionState(application, section)?.editable ?? false);
}

/** How much is left before the application can be sent — the number the wizard's banner quotes. */
export function outstandingCount(application: B2BApplication): number {
    const sections = application.sectionStates.filter((state) => !state.complete).length;
    return sections + missingDocumentKinds(application).length;
}

/** The section payload a step's form starts from — the server's values, never a local draft. */
export function sectionValues<S extends B2BApplicationSection>(
    application: B2BApplication,
    section: S,
): B2BApplicationSections[S] {
    return application.sections[section];
}

/* ── state grouping ───────────────────────────────────────────────────────────────────────────── */

/**
 * Whether an application is still being written by its applicant.
 *
 * Used by the routes to decide between the wizard and the status panel, and it is deliberately a
 * function of the *state* rather than of which screen somebody typed: an approved application
 * opened at `/apply/company` shows the status panel, not an editable form nobody will read.
 */
export function isApplicantEditable(application: B2BApplication): boolean {
    return application.state === 'draft' || application.state === 'info_requested';
}

/** Whether there is an agreement waiting for this person to do something about it. */
export function awaitsSignature(application: B2BApplication): boolean {
    return (
        application.state === 'agreement_pending' &&
        application.agreement !== null &&
        application.agreement.status === 'pending_signature'
    );
}

/** Whether the account is being, or has been, built. */
export function isProvisioning(application: B2BApplication): boolean {
    return (
        application.state === 'agreement_signed' ||
        application.state === 'provisioning' ||
        application.state === 'provisioned'
    );
}
