<?php

declare(strict_types=1);

namespace Healthy360\Support\Attributes;

use Attribute;
use Healthy360\Support\Enums\DataClassification;
use ReflectionClass;

/**
 * Declares the classification of one or more attributes of a class.
 *
 * Eloquent attributes are not PHP properties, so the declaration is repeated
 * on the class and names the columns it covers:
 *
 *     #[Classified(DataClassification::Restricted, 'two_factor_secret')]
 *
 * It may equally be placed on a real typed property of a DTO, where the names
 * are omitted and the property itself is the subject.
 *
 * Phase 6 scope is the declaration and its reader. Nothing yet consumes the
 * map to drive redaction or encryption automatically — that machinery is
 * deferred, and the honest statement of what does and does not exist is in
 * docs/architecture/notes/rls-implementation.md.
 */
#[Attribute(Attribute::TARGET_CLASS | Attribute::TARGET_PROPERTY | Attribute::IS_REPEATABLE)]
final class Classified
{
    /** @var list<string> */
    public readonly array $attributes;

    public function __construct(
        public readonly DataClassification $classification,
        string ...$attributes,
    ) {
        $this->attributes = array_values($attributes);
    }

    /**
     * The declared classification of every attribute of a class, including
     * those inherited from parent classes.
     *
     * @param  class-string  $class
     * @return array<string, DataClassification>
     */
    public static function map(string $class): array
    {
        $map = [];
        $reflection = new ReflectionClass($class);

        foreach (array_reverse(self::hierarchy($reflection)) as $level) {
            foreach ($level->getAttributes(self::class) as $attribute) {
                $declaration = $attribute->newInstance();

                foreach ($declaration->attributes as $name) {
                    $map[$name] = $declaration->classification;
                }
            }

            foreach ($level->getProperties() as $property) {
                foreach ($property->getAttributes(self::class) as $attribute) {
                    $map[$property->getName()] = $attribute->newInstance()->classification;
                }
            }
        }

        return $map;
    }

    /**
     * @param  ReflectionClass<object>  $reflection
     * @return list<ReflectionClass<object>>
     */
    private static function hierarchy(ReflectionClass $reflection): array
    {
        $hierarchy = [$reflection];

        while (($reflection = $reflection->getParentClass()) !== false) {
            $hierarchy[] = $reflection;
        }

        return $hierarchy;
    }
}
