<?php

declare(strict_types=1);

namespace Healthy360\Customers\Closure\Enums;

/**
 * Why somebody is leaving.
 *
 * **A fixed vocabulary rather than free text**, for the reason
 * `CancellationReason` gives on the orders side and one more besides. The
 * answer is read by machines as often as by people — "how many customers left
 * because we do not deliver to them any more" is a count, not a search — and
 * free text is how personal data ends up in a column nobody classified. A
 * closure reason is written by somebody in an unhappy moment, which is exactly
 * when a text box collects a name, an address and a complaint about a named
 * member of staff.
 *
 * `reason_note` exists beside it for the person who wants to say more. It is
 * optional, it is classified, and it is deleted at finalisation with everything
 * else.
 *
 * **The vocabulary is bilingual here rather than in a table.** Every other
 * seeded vocabulary in this codebase — allergens, diet classifications, product
 * categories — is a table because something else holds a foreign key to it and
 * because operators add rows. Neither is true of this list: the values are
 * pinned by a CHECK constraint, nothing joins to them, and adding a reason is a
 * product decision that changes the closure screen. A table would be a
 * migration, a seeder, a JSON data file and a model to express eight constants
 * that the CHECK already pins. The labels are drafts pending copy review, and
 * the Arabic marked `AR_PENDING` says so rather than shipping a machine
 * translation of somebody's reason for leaving.
 *
 * **`Other` is last and deliberately vague.** A vocabulary without an escape
 * hatch does not stop people leaving for reasons nobody listed; it makes them
 * pick the nearest wrong answer, which is worse than an honest "something
 * else" because it is indistinguishable from a real signal.
 */
enum ClosureReasonCode: string
{
    case NoLongerNeeded = 'no_longer_needed';

    case TooExpensive = 'too_expensive';

    case MovingAway = 'moving_away';

    case DietaryNeedsUnmet = 'dietary_needs_unmet';

    case ServiceQuality = 'service_quality';

    case PrivacyConcerns = 'privacy_concerns';

    case DuplicateAccount = 'duplicate_account';

    case Other = 'other';

    /**
     * The marker used where no reviewed Arabic copy exists yet.
     *
     * Stated rather than machine-translated, and identical to the convention
     * the consent seeder uses: a placeholder that announces itself is a
     * translation task, a plausible-looking wrong translation is a defect
     * nobody will find.
     */
    public const string AR_PENDING = '[AR pending translation]';

    /**
     * The draft English label.
     *
     * Pending copy review (the same status the consent bodies carry). Nothing
     * downstream may present these as approved product copy.
     */
    public function labelEn(): string
    {
        return match ($this) {
            self::NoLongerNeeded => 'I no longer need this service',
            self::TooExpensive => 'It costs more than I want to spend',
            self::MovingAway => 'I am moving outside the delivery area',
            self::DietaryNeedsUnmet => 'My dietary needs are not met',
            self::ServiceQuality => 'I am unhappy with the food or the service',
            self::PrivacyConcerns => 'I do not want my data held any longer',
            self::DuplicateAccount => 'I have another account',
            self::Other => 'Another reason',
        };
    }

    public function labelAr(): string
    {
        return match ($this) {
            self::MovingAway => 'سأنتقل خارج منطقة التوصيل',
            self::TooExpensive => 'التكلفة أعلى مما أرغب في إنفاقه',
            default => self::AR_PENDING,
        };
    }

    /**
     * Whether a free-text note adds anything a reader could act on.
     *
     * True only for `Other`, and it is a prompt rather than a rule: the note
     * stays optional everywhere, because insisting somebody explain themselves
     * before they may leave is a dark pattern wearing a form label.
     */
    public function invitesNote(): bool
    {
        return $this === self::Other;
    }

    /**
     * The whole vocabulary, for a closure screen to render.
     *
     * @return list<array{code: string, label_en: string, label_ar: string, invites_note: bool}>
     */
    public static function vocabulary(): array
    {
        return array_map(static fn (self $reason): array => [
            'code' => $reason->value,
            'label_en' => $reason->labelEn(),
            'label_ar' => $reason->labelAr(),
            'invites_note' => $reason->invitesNote(),
        ], self::cases());
    }
}
