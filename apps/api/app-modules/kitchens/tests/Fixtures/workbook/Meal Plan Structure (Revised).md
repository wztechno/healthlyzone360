<!--
    SYNTHETIC FIXTURE. Eight invented plans and a full twelve-column
    availability matrix. Plan names, meal names and identifiers are made up.
    The double spaces in "Fixture Green  Plan" and "Fixture Cleansing  Plan"
    are deliberate: they are the quirk under test.
-->

Sheet1:Fixture Workbook — Meal Plan Structure

| Synthetic fixture data for the meal-plan parser. | Synthetic fixture data for the meal-plan parser. | Synthetic fixture data for the meal-plan parser. |
| --- | --- | --- |
|  | Document | Meal Plan Structure — fixture |
|  | 1. Plans | Named plans. |
|  | 2. Plan Families & Setup | Combinations, calorie bands, subscription durations. |
|  | 3. Meal-to-Plan Map | EXAMPLE data in the source. |

Sheet2:1 · Plans (fixture catalogue)

| The sellable plans. Plan Type to be confirmed; Status defaults to Active. | The sellable plans. Plan Type to be confirmed; Status defaults to Active. | The sellable plans. Plan Type to be confirmed; Status defaults to Active. | The sellable plans. Plan Type to be confirmed; Status defaults to Active. | The sellable plans. Plan Type to be confirmed; Status defaults to Active. |
| --- | --- | --- | --- | --- |
| Plan ID | Plan Name | Plan Type | Status | Notes |
| PLN-001 | Fixture General Plan | Both | Active |  |
| PLN-002 | Fixture Weight Plan | Subscription | Active |  |
| PLN-003 | Fixture Protein Plan | Subscription | Active |  |
| PLN-004 | Fixture Carb Plan | Subscription | Active |  |
| PLN-005 | Fixture Green  Plan | Subscription | Active | Name carries a double space in both sheets |
| PLN-006 | Fixture Desk Lunch | Limited Time | Active | Offered at midday only |
| PLN-007 | Fixture Cleansing  Plan | Limited Time | Active | Spelled with one space in the matrix |
| PLN-008 | Fixture Trial Plan | Seasonal | Draft | Plan type is not one of the three the source defines |

Sheet3:2 · Plan Families & Setup

| Configuration building blocks: combinations, calorie bands and subscription durations. | Configuration building blocks: combinations, calorie bands and subscription durations. | Configuration building blocks: combinations, calorie bands and subscription durations. | Configuration building blocks: combinations, calorie bands and subscription durations. |
| --- | --- | --- | --- |
| Meal-Combination Options | Meal-Combination Options | Meal-Combination Options | Meal-Combination Options |
| Option | Tier | Includes Snacks |  |
| Free Selection | Standard | No | Breakfast / Lunch / Dinner / Snacks |
| Breakfast + Lunch | Standard | No |  |
| Breakfast + Lunch | Premium | Yes | with Snacks |
| Breakfast + Dinner | Standard | No |  |
| Breakfast + Dinner | Premium | Yes | with Snacks |
| Lunch + Dinner | Standard | No |  |
| Lunch + Dinner | Premium | Yes | with Snacks |
| Full Day | Standard | No |  |
| Full Day | Premium | Yes | with Snacks |
| Calorie Bands  (impact price) | Calorie Bands  (impact price) | Calorie Bands  (impact price) | Calorie Bands  (impact price) |
| Band (kcal/day) | Min | Max | Notes |
| 800 - 1000 | 800 | 1000 | Impacts price |
| 1050 - 1250 | 1050 | 1250 | Impacts price |
| 1300 - 1450 | 1300 | 1450 | Impacts price |
| 1500 - 1750 | 1500 | 1750 | Impacts price |
| 1800 - 2000 | 1800 | 2000 | Impacts price |
| 2050 - 2200 | 2050 | 2200 | Impacts price |
| Subscription Durations | Subscription Durations | Subscription Durations | Subscription Durations |
| Duration | Days | Notes | Notes |
| No subscription | 0 | One-off | One-off |
| 5 days | 5 |  |  |
| 20 days | 20 |  |  |
| 40 days | 40 |  |  |
| 60 days | 60 |  |  |
| Subscription rule: the customer controls the delivery schedule. | Subscription rule: the customer controls the delivery schedule. | Subscription rule: the customer controls the delivery schedule. | Subscription rule: the customer controls the delivery schedule. |

Sheet4:7 · Meal-to-Plan Map  (EXAMPLE data — validate)

| Y = meal is available in that plan. The source flagged this as illustrative, not final data. | Y = meal is available in that plan. The source flagged this as illustrative, not final data. | Y = meal is available in that plan. The source flagged this as illustrative, not final data. | Y = meal is available in that plan. The source flagged this as illustrative, not final data. |
| --- | --- | --- | --- |
| Meals | Category | Fixture General Plan | Fixture Weight Plan |
| Fixture Breakfast Bowl | Meal | Y | Y |
| Fixture Garden Salad | Salad | Y |  |
| Fixture Green Juice | Juice | Y | Y |
| Fixture Nut Handful | Nuts/Seeds | Y |  |

Sheet5:1 · Plan Pricing (per day) 

| Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. | Full Package = Breakfast + Lunch + Dinner + Snack. Blank = not offered. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plan Name | Breakfast | Lunch | Dinner | Snack | Breakfast + Lunch (Standard) | Breakfast + Lunch (Premium) | Breakfast + Dinner (Standard) | Breakfast + Dinner (Premium) | Lunch + Dinner (Standard) | Lunch + Dinner (Premium) | Full Day (Standard) | Full Day (Premium) |
| Fixture General Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Weight Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Protein Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Carb Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Green  Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Desk Lunch |  | Y |  | Y |  |  |  |  |  |  |  |  |
| Fixture Cleansing Plan | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y | Y |
| Fixture Retired Plan | Y |  |  |  |  |  |  |  |  |  |  |  |
| * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis | * Prices are on daily basis |
| * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected | * Discounts applied based on number of days selected |
