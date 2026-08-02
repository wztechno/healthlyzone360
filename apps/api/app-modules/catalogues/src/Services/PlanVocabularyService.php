<?php

declare(strict_types=1);

namespace Healthy360\Catalogues\Services;

use Healthy360\Audit\Services\AuditRecorder;
use Healthy360\Catalogues\Enums\PlanDurationKind;
use Healthy360\Catalogues\Models\EnergyBand;
use Healthy360\Catalogues\Models\MealCombinationOption;
use Healthy360\Catalogues\Models\PlanDuration;
use Healthy360\Support\Api\ErrorCode;
use Healthy360\Support\Api\Exceptions\ApiException;
use Healthy360\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * The three vocabularies a subscription plan's matrix is built out of: meal
 * combinations, energy bands and durations.
 *
 * **A kitchen's own words, not the platform's.** Unlike diet classifications or
 * allergen classes, none of these is a shared regulatory or filtering
 * vocabulary: "full board" means what each kitchen sells it as, a calorie
 * bracket is a portioning decision, and one kitchen's shortest run is another's
 * trial week. A platform library here would have to be the union of everybody's
 * marketing, so `organisation_id` is NOT NULL on all three and nothing is
 * seeded.
 *
 * **Deactivate, never delete.** There is no destroy path in this service and no
 * DELETE route above it. A vocabulary row is pointed at by a plan variant, and
 * that variant is pointed at by a price and eventually by an order; withdrawing
 * it is `is_active = false`, which stops it being offered while leaving every
 * row that references it intelligible. The `restrictOnDelete` foreign keys on
 * `plan_variant_profiles` and `plan_variant_durations` are the backstop: even a
 * direct `DELETE` is refused by PostgreSQL, so the rule survives a console, an
 * importer and whatever writes this schema in three years.
 *
 * **No `lock_version`, so no `If-Match`.** These rows carry no optimistic
 * validator (appendix D), and the concurrency contract applies only to
 * resources that do (`docs/api/conventions.md`) — sending a validator a
 * resource cannot honour would be worse than sending none. The update is a
 * plain write with an audit record beside it. That is a considered asymmetry
 * with catalogue items rather than an oversight: two editors renaming a band at
 * once is a lost caption, and two editors replacing a plan's matrix at once is
 * a lost tariff.
 *
 * **The duration rule is enforced twice, on purpose.** The database CHECK is
 * what makes the zero-day sentinel unreintroducible by any writer (§4.3); the
 * refusal here is what explains itself. A constraint violation reaches a client
 * as a 500 with a constraint name in it and teaches nobody anything, whereas
 * "a one-off has no length" teaches the rule once. Same argument the price
 * amount/status pair makes in K1.5.
 */
final readonly class PlanVocabularyService
{
    public function __construct(
        private TenantContext $context,
        private AuditRecorder $audit,
    ) {}

    /**
     * @param  array{code: string, name_en: string, name_ar?: string|null, includes_breakfast?: bool|null, includes_lunch?: bool|null, includes_dinner?: bool|null, meals_per_day: int, display_order?: int|null}  $attributes
     *
     * @throws ApiException
     */
    public function createCombination(array $attributes): MealCombinationOption
    {
        $organisationId = $this->requireOrganisation();
        $code = $this->availableCode(MealCombinationOption::withoutTenancy(), $attributes['code'], $organisationId, 'combination');

        $row = new MealCombinationOption;
        $row->organisation_id = $organisationId;
        $row->code = $code;
        $row->created_by = $this->context->userId();

        // Spelled out rather than left to the column defaults, because the
        // model instance is read back by the presenter before it is reloaded:
        // an unset attribute would serialise as `null` on a boolean a client
        // branches on.
        $row->includes_breakfast = false;
        $row->includes_lunch = false;
        $row->includes_dinner = false;
        $row->display_order = 0;

        $this->applyCombination($row, $this->withArabicFallback($attributes));
        $row->is_active = true;
        $row->save();

        $this->recordVocabulary('combinations', $row, 'created', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function updateCombination(MealCombinationOption $row, array $attributes): MealCombinationOption
    {
        $this->applyCombination($row, $attributes);

        if (array_key_exists('is_active', $attributes)) {
            $row->is_active = (bool) $attributes['is_active'];
        }

        $row->save();

        $this->recordVocabulary('combinations', $row, 'updated', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array{code: string, name_en: string, name_ar?: string|null, min_kcal: int, max_kcal: int, display_order?: int|null}  $attributes
     *
     * @throws ApiException
     */
    public function createEnergyBand(array $attributes): EnergyBand
    {
        $organisationId = $this->requireOrganisation();
        $code = $this->availableCode(EnergyBand::withoutTenancy(), $attributes['code'], $organisationId, 'band');

        $row = new EnergyBand;
        $row->organisation_id = $organisationId;
        $row->code = $code;
        $row->created_by = $this->context->userId();
        $row->display_order = 0;

        $this->applyEnergyBand($row, $this->withArabicFallback($attributes));
        $row->is_active = true;
        $row->save();

        $this->recordVocabulary('energy_bands', $row, 'created', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function updateEnergyBand(EnergyBand $row, array $attributes): EnergyBand
    {
        $this->applyEnergyBand($row, $attributes);

        if (array_key_exists('is_active', $attributes)) {
            $row->is_active = (bool) $attributes['is_active'];
        }

        $row->save();

        $this->recordVocabulary('energy_bands', $row, 'updated', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array{code: string, duration_kind: string, duration_days?: int|null, name_en: string, name_ar?: string|null, display_order?: int|null}  $attributes
     *
     * @throws ApiException
     */
    public function createDuration(array $attributes): PlanDuration
    {
        $organisationId = $this->requireOrganisation();
        $code = $this->availableCode(PlanDuration::withoutTenancy(), $attributes['code'], $organisationId, 'duration');

        $row = new PlanDuration;
        $row->organisation_id = $organisationId;
        $row->code = $code;
        $row->created_by = $this->context->userId();
        $row->duration_days = null;
        $row->display_order = 0;

        $this->applyDuration($row, $this->withArabicFallback($attributes));
        $row->is_active = true;
        $row->save();

        $this->recordVocabulary('durations', $row, 'created', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    public function updateDuration(PlanDuration $row, array $attributes): PlanDuration
    {
        $this->applyDuration($row, $attributes);

        if (array_key_exists('is_active', $attributes)) {
            $row->is_active = (bool) $attributes['is_active'];
        }

        $row->save();

        $this->recordVocabulary('durations', $row, 'updated', array_keys($attributes));

        return $row;
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    private function applyCombination(MealCombinationOption $row, array $attributes): void
    {
        foreach (['name_en', 'name_ar'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $row->setAttribute($field, $this->requiredName($attributes[$field], $field, $row->name_en ?? ''));
            }
        }

        foreach (['includes_breakfast', 'includes_lunch', 'includes_dinner'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $row->setAttribute($field, (bool) $attributes[$field]);
            }
        }

        if (array_key_exists('meals_per_day', $attributes)) {
            $row->meals_per_day = $this->positiveInt($attributes['meals_per_day'], 'meals_per_day');
        }

        if (array_key_exists('display_order', $attributes)) {
            $row->display_order = (int) $attributes['display_order'];
        }

        // A combination that covers no sitting at all is not a combination.
        // Refused rather than stored, because a variant built on it would be a
        // plan that delivers nothing.
        if (! $row->includes_breakfast && ! $row->includes_lunch && ! $row->includes_dinner) {
            throw $this->invalid(
                'includes_lunch',
                'A meal combination has to cover at least one sitting — breakfast, lunch or dinner.',
            );
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    private function applyEnergyBand(EnergyBand $row, array $attributes): void
    {
        foreach (['name_en', 'name_ar'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $row->setAttribute($field, $this->requiredName($attributes[$field], $field, $row->name_en ?? ''));
            }
        }

        foreach (['min_kcal', 'max_kcal'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $row->setAttribute($field, (int) $attributes[$field]);
            }
        }

        if (array_key_exists('display_order', $attributes)) {
            $row->display_order = (int) $attributes['display_order'];
        }

        if ($row->min_kcal < 0) {
            throw $this->invalid('min_kcal', 'A calorie band starts at zero or above.');
        }

        if ($row->max_kcal <= $row->min_kcal) {
            throw $this->invalid(
                'max_kcal',
                'A calorie band has to end above where it starts. A band whose ends meet is a single value, not a range.',
            );
        }
    }

    /**
     * The duration rule of §4.3, stated where a human can read the refusal.
     *
     * Both halves are checked against the row **after** the submitted fields
     * have been applied, not against the request: a PATCH that flips a fixed run
     * to `one_off` without mentioning `duration_days` has to clear the number,
     * and a PATCH that only sends `duration_days` is judged against the kind
     * already stored.
     *
     * @param  array<string, mixed>  $attributes
     *
     * @throws ApiException
     */
    private function applyDuration(PlanDuration $row, array $attributes): void
    {
        foreach (['name_en', 'name_ar'] as $field) {
            if (array_key_exists($field, $attributes)) {
                $row->setAttribute($field, $this->requiredName($attributes[$field], $field, $row->name_en ?? ''));
            }
        }

        if (array_key_exists('duration_kind', $attributes)) {
            $kind = PlanDurationKind::tryFrom(trim((string) $attributes['duration_kind']));

            if ($kind === null) {
                throw $this->invalid(
                    'duration_kind',
                    'A duration is either a one-off purchase or a fixed run of days. There is no zero-day subscription.',
                );
            }

            $row->duration_kind = $kind;
        }

        if (array_key_exists('duration_days', $attributes)) {
            $days = $attributes['duration_days'];
            $row->duration_days = $days === null || $days === '' ? null : (int) $days;
        }

        if (array_key_exists('display_order', $attributes)) {
            $row->display_order = (int) $attributes['display_order'];
        }

        if (! $row->duration_kind->carriesDays()) {
            if ($row->duration_days !== null) {
                throw $this->invalid(
                    'duration_days',
                    'A one-off purchase has no length. Leave the number out, or make this a fixed run of days.',
                );
            }

            return;
        }

        if ($row->duration_days === null || $row->duration_days <= 0) {
            throw $this->invalid(
                'duration_days',
                'A fixed run needs a length of at least one day. Use the one-off kind for a single purchase — zero days is not a duration.',
            );
        }
    }

    /**
     * The submitted code, once it is known to be free within the organisation.
     *
     * The caller supplies the *scope* rather than a class name: the three
     * vocabularies are three unrelated models, and a `class-string` parameter
     * would put a dynamic static call where nothing can check it.
     *
     * @param  Builder<MealCombinationOption>|Builder<EnergyBand>|Builder<PlanDuration>  $scope
     *
     * @throws ApiException
     */
    private function availableCode(Builder $scope, string $submitted, string $organisationId, string $subject): string
    {
        $code = trim($submitted);

        if ($code === '') {
            throw $this->invalid('code', 'This '.$subject.' needs a code — it is what a plan configuration will name it by.');
        }

        $taken = $scope
            ->where('organisation_id', $organisationId)
            ->where('code', $code)
            ->exists();

        if ($taken) {
            throw new ApiException(
                ErrorCode::ResourceConflict,
                'A '.$subject.' with this code already exists in this organisation.',
                ['entry' => $code],
            );
        }

        return $code;
    }

    /**
     * Make the Arabic name an explicit part of a creation, present or not.
     *
     * A `nullable` field a client omitted never reaches `validated()`, so
     * without this an omitted `name_ar` would leave the column unwritten and
     * the insert would fail on a NOT NULL constraint — a 500 where the honest
     * answer is "we used the English name". Naming the key makes the fallback
     * below run instead.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    private function withArabicFallback(array $attributes): array
    {
        $attributes['name_ar'] = $attributes['name_ar'] ?? null;

        return $attributes;
    }

    /**
     * Names are required on all three vocabularies, in both languages.
     *
     * Unlike a catalogue item — where an empty `name_ar` is the meaningful "not
     * yet translated" state the publish gate refuses — a vocabulary row is a
     * label on a control, and an empty one renders as a blank option nobody can
     * choose. So the Arabic falls back to the English rather than being stored
     * empty, which is the recipes module's rule and the right one here.
     *
     * @throws ApiException
     */
    private function requiredName(mixed $value, string $field, string $fallback): string
    {
        $name = is_string($value) ? trim($value) : '';

        if ($name !== '') {
            return $name;
        }

        if ($field === 'name_ar' && $fallback !== '') {
            return $fallback;
        }

        throw $this->invalid($field, 'This needs a name.');
    }

    /**
     * @throws ApiException
     */
    private function positiveInt(mixed $value, string $field): int
    {
        if (! is_numeric($value) || (int) $value <= 0) {
            throw $this->invalid($field, 'This must be a whole number greater than zero.');
        }

        return (int) $value;
    }

    /**
     * @param  MealCombinationOption|EnergyBand|PlanDuration  $row
     * @param  list<string>  $submittedFields
     */
    private function recordVocabulary(string $vocabulary, Model $row, string $operation, array $submittedFields): void
    {
        $this->audit->record(
            'catalogue.plan_vocabulary_updated',
            actorUserId: $this->context->userId(),
            subjectType: 'plan_vocabulary',
            subjectId: (string) $row->getKey(),
            metadata: [
                // `vocabulary` and `entry`, never `*_code`: the audit redactor
                // blanks any key containing "code" on a substring match
                // (OQ-036), so the naming convention is what keeps this record
                // readable.
                'vocabulary' => $vocabulary,
                'entry' => (string) $row->getAttribute('code'),
                'operation' => $operation,
                'changed_fields' => array_values(array_diff($submittedFields, ['code'])),
            ],
        );
    }

    /**
     * @throws ApiException
     */
    private function requireOrganisation(): string
    {
        $organisationId = $this->context->organisationId();

        if ($organisationId === null) {
            throw new ApiException(ErrorCode::ContextOrganisationRequired);
        }

        return $organisationId;
    }

    private function invalid(string $field, string $message): ApiException
    {
        return new ApiException(
            ErrorCode::ValidationFailed,
            $message,
            ['fields' => [$field => [$message]]],
        );
    }
}
