<?php

declare(strict_types=1);

namespace Healthy360\Customers\Enums;

/**
 * How serious a declared allergen is for this person.
 *
 * **None of these is a diagnosis** and none may be presented as one. They are
 * the customer's own account of what happens, recorded because a kitchen
 * deciding whether "produced in a facility that also handles nuts" is
 * acceptable needs to know whether it is holding a preference or an emergency.
 * A single "allergic: yes" flag flattens that distinction and pushes the
 * judgement onto whoever reads it.
 */
enum AllergenSeverity: string
{
    /** A choice to avoid. No reaction claimed. */
    case Avoidance = 'avoidance';

    /** Discomfort rather than an immune reaction. */
    case Intolerance = 'intolerance';

    /** A reaction the person describes as an allergy. */
    case Allergy = 'allergy';

    /** A reaction the person describes as life-threatening. */
    case Anaphylaxis = 'anaphylaxis';

    /**
     * Whether trace or shared-equipment containment must be treated as a
     * refusal rather than a warning.
     *
     * The conservative reading is deliberate: at these severities the cost of
     * being wrong is not a returned meal.
     */
    public function excludesTraces(): bool
    {
        return in_array($this, [self::Allergy, self::Anaphylaxis], true);
    }
}
