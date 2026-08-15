<?php

declare(strict_types=1);

namespace Healthy360\Ingredients\Enums;

/**
 * Where a mapping came from. Provenance is part of the food-safety record:
 * "the platform master list says so" and "our supplier told us" carry very
 * different weight when a label is challenged.
 */
enum AllergenMappingSource: string
{
    case MasterList = 'master_list';
    case TechnicalSheet = 'technical_sheet';
    case SupplierDeclaration = 'supplier_declaration';
    case KitchenDeclared = 'kitchen_declared';
    case Inferred = 'inferred';
}
