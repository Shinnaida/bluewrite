<?php

declare(strict_types=1);

namespace BlueWrite\Tests;

use App\Ai\AiNarrativeProvider;
use App\Ai\AiProviderException;
use App\Ai\GeminiNarrativeProvider;
use App\Ai\NarrativeService;
use App\Rules\ReportRules;
use PHPUnit\Framework\TestCase;

/**
 * Phase 7 — POST /ai/classify, the free-form account read.
 *
 * The one AI call that runs with NO report behind it: it names the parts of the
 * official report the officer's own words already contain, so the editor can
 * create the draft with the right incident type — which the API requires and
 * the generation prompt is scoped to.
 *
 * Everything here is PURE: no HTTP, no database, no API key, no model call. The
 * provider's transport is the one thing that cannot be exercised offline, and
 * it is deliberately not what these tests cover. What they cover is the part
 * that decides what the officer's report will say:
 *
 *   1. the response schema — that the type is pinned to the station's own list,
 *      and that every field is required and allowed to be EMPTY, because an
 *      empty field is the answer "your account does not state this";
 *   2. the instruction — that the type list and TODAY actually reach the model,
 *      the two facts only the app knows and the two the reading depends on;
 *   3. normaliseClassification() — the report's own field names, and every
 *      answer the report cannot carry being REJECTED rather than repaired (a
 *      type off the list, a datetime that is not one, a role that is not one, a
 *      party with no name);
 *   4. NarrativeService::classifyAccount() — what it passes to the provider and
 *      what it reports back, driven through the stub provider;
 *   5. the SECOND half of the same read, POST /ai/classify/details — the
 *      incident type's OWN fields. That half is scoped by a field list the app
 *      assembles (ReportRules::scalarKeysFor / groupsFor), so what is asserted
 *      here is that the list reaching the model is exactly the form's own: no
 *      field the type does not have, no mirrored scalar (which belongs to a
 *      row), and every answer about a field that was not asked dropped.
 *
 * Run directly:
 *   php phpunit.phar --bootstrap tests/bootstrap.php tests/AiClassifyTest.php
 */
final class AiClassifyTest extends TestCase
{
    /** The station's list, as ReportsController::allowedTypes() builds it. */
    private const TYPES = [
        'Theft', 'Robbery', 'Assault / Physical Injury', 'Traffic Accident',
        'Rape / Sexual Assault', 'Domestic Violence', 'Missing Person',
        'Lost Property', 'Fraud / Estafa', 'Property Damage / Malicious Mischief',
        'Fire Incident', 'Drug-Related Incident', 'Burglary / Break-In', 'Other Incident',
    ];

    protected function setUp(): void
    {
        require_once __DIR__ . '/../app/ai/AiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/AiNarrativeResult.php';
        require_once __DIR__ . '/../app/ai/AiProviderException.php';
        require_once __DIR__ . '/../app/ai/AiUnavailableException.php';
        require_once __DIR__ . '/../app/ai/MaskingGateway.php';
        require_once __DIR__ . '/../app/ai/GeminiNarrativeProvider.php';
        require_once __DIR__ . '/../app/ai/CachedInstructionStore.php';
        require_once __DIR__ . '/../app/ai/NarrativeEconomy.php';
        require_once __DIR__ . '/../app/ai/NarrativeService.php';
        // The type-scoped half of the read is scoped by THIS table: the type's
        // own field keys and its groups. Required because the list is assembled
        // from it rather than passed in, which is the property under test.
        require_once __DIR__ . '/../app/rules/report_rules.php';
        require_once __DIR__ . '/StubNarrativeProvider.php';
    }

    /**
     * The group config as NarrativeService hands it to a provider: each group's
     * label and its field KEYS (ReportRules owns the per-field rules, which are
     * not part of what a reading is asked about).
     *
     * @return array<string, array{label:string, fields:string[]}>
     */
    /**
     * The whole form descriptor NarrativeService hands to a provider, assembled
     * the same way (from ReportRules, never from the request).
     *
     * @return array<string,mixed>
     */
    private function form(string $incidentType): array
    {
        return [
            'scalars' => ReportRules::scalarKeysFor($incidentType),
            'groups' => $this->groupsFor($incidentType),
            'selects' => ReportRules::selectOptionsFor($incidentType),
            'required' => ReportRules::requiredScalarKeysFor($incidentType),
            'conditional' => ReportRules::conditionalScalarKeysFor($incidentType),
        ];
    }

    private function groupsFor(string $incidentType): array
    {
        $rowVocabulary = ReportRules::groupSelectOptionsFor($incidentType);
        $out = [];
        foreach (ReportRules::groupsFor($incidentType) ?? [] as $key => $cfg) {
            $out[$key] = [
                'label' => (string) ($cfg['label'] ?? $key),
                'fields' => array_keys((array) ($cfg['fields'] ?? [])),
            ];
            if (isset($rowVocabulary[$key])) {
                $out[$key]['selects'] = $rowVocabulary[$key];
            }
        }
        return $out;
    }

    // ---------------------------------------------------------------- schema

    /**
     * The type is an ENUM of the station's own list, so a type this station
     * does not carry cannot come back at all — the create would reject it
     * afterwards, and the officer would be left holding a dead answer.
     */
    public function testSchemaPinsTheIncidentTypeToTheStationsOwnList(): void
    {
        $schema = GeminiNarrativeProvider::classificationSchema(self::TYPES);

        $this->assertSame(
            self::TYPES,
            $schema['properties']['incidentType']['enum'],
        );
        $this->assertNotContains(
            'Carnapping',
            $schema['properties']['incidentType']['enum'],
            'a type the station does not carry must not be selectable by the model',
        );
    }

    /**
     * Every field is required AND every field may be empty. That combination is
     * the whole contract: the model has to decide-and-say that the account does
     * not state something, rather than leave an optional field out and let the
     * caller guess whether it was asked.
     */
    public function testSchemaRequiresEveryFieldAndKeepsThemAllOptionalInValue(): void
    {
        $schema = GeminiNarrativeProvider::classificationSchema(self::TYPES);

        $expected = [
            'incidentType', 'incidentDatetime', 'timeApproximate', 'location',
            'reporterName', 'reporterContact', 'reporterAddress', 'actionTaken',
            'parties', 'unstated',
        ];
        $this->assertSame($expected, $schema['required']);
        foreach ($expected as $field) {
            $this->assertArrayHasKey($field, $schema['properties']);
            // "required" here means PRESENT in the answer, never non-empty:
            // the nullability the empty answer needs lives in the type
            // ('string' with no 'minLength', an array with no 'minItems').
            $this->assertArrayNotHasKey('minLength', $schema['properties'][$field]);
            $this->assertArrayNotHasKey('minItems', $schema['properties'][$field]);
        }
    }

    /**
     * A party is filed under a role the REPORT knows — the report's role field
     * has its own vocabulary, and an invented one would not survive it.
     */
    public function testSchemaConstrainsAPartyRoleToTheReportsRoleVocabulary(): void
    {
        $schema = GeminiNarrativeProvider::classificationSchema(self::TYPES);
        $roles = $schema['properties']['parties']['items']['properties']['role']['enum'];

        foreach (['victim', 'suspect', 'respondent', 'witness', 'complainant', 'driver', 'owner', 'other'] as $role) {
            $this->assertContains($role, $roles);
        }
        $this->assertSame(['role', 'name'], $schema['properties']['parties']['items']['required']);
    }

    // ----------------------------------------------------------- instruction

    /**
     * The two facts only the app knows have to reach the model: the station's
     * list (the enum's source, repeated in words because a schema cannot tell
     * the model what "Theft" means at this station) and today's date, which is
     * what a relative day in the account resolves against ("gahapon").
     */
    public function testInstructionCarriesTheStationsTypesAndTodaysDate(): void
    {
        $instruction = GeminiNarrativeProvider::classificationInstruction(self::TYPES, '2026-09-20');

        foreach (self::TYPES as $type) {
            $this->assertStringContainsString('  - ' . $type . "\n", $instruction);
        }
        $this->assertStringContainsString('TODAY: 2026-09-20', $instruction);
        // The resource file is the body, not a stub: the one rule the whole
        // call rests on has to be in what the model is actually sent.
        $this->assertStringContainsString('Report what the account STATES', $instruction);
        $this->assertStringContainsString('Leave everything else EMPTY', $instruction);
    }

    /** A missing or empty resource file would silently send no rules at all. */
    public function testTheClassificationPromptResourceExistsAndIsSubstantial(): void
    {
        $path = dirname(__DIR__) . '/resources/ai/classification_prompt.txt';
        $this->assertFileExists($path);
        $this->assertGreaterThan(1500, strlen((string) file_get_contents($path)));
    }

    // ------------------------------------------------- normaliseClassification

    /**
     * A type the station does not carry reads as EMPTY, never as itself: the
     * create would reject it, so passing it on would only move the failure to
     * the officer's next click.
     */
    public function testATypeOffTheListReadsAsEmpty(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification(
            ['incidentType' => 'Carnapping'],
            self::TYPES,
        );

        $this->assertSame('', $out['incident_type']);
    }

    /**
     * A type the model spelled differently still lands, and what comes back is
     * the STATION's spelling — the exact string POST /reports accepts.
     */
    public function testATypeIsMatchedCaseInsensitivelyAndReturnsTheStationsSpelling(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification(
            ['incidentType' => '  theft '],
            self::TYPES,
        );

        $this->assertSame('Theft', $out['incident_type']);
    }

    /**
     * A datetime is a datetime. A bare date, a bare time, a sentence or a
     * wrong order is not one, and an empty field is honest — the report's own
     * date and time stay untouched for the officer to fill.
     */
    public function testOnlyAnIsoMinuteDatetimeSurvives(): void
    {
        $cases = [
            '2026-09-19T20:30' => '2026-09-19T20:30',
            '2026-09-19' => '',
            '20:30' => '',
            'yesterday around eight in the evening' => '',
            '2026-09-19T20:30:00' => '',
            '09/19/2026 8:30 PM' => '',
        ];
        foreach ($cases as $given => $expected) {
            $out = GeminiNarrativeProvider::normaliseClassification(
                ['incidentDatetime' => $given],
                self::TYPES,
            );
            $this->assertSame($expected, $out['incident_datetime'], "input: {$given}");
        }
    }

    /** The hedge is carried as a flag, not merged into the datetime prose. */
    public function testTheApproximateFlagIsACleanBoolean(): void
    {
        $this->assertTrue(
            GeminiNarrativeProvider::normaliseClassification(['timeApproximate' => true], self::TYPES)['incident_time_approximate'],
        );
        $this->assertFalse(
            GeminiNarrativeProvider::normaliseClassification([], self::TYPES)['incident_time_approximate'],
        );
    }

    /** A role is not a person: a party with no name is dropped, not listed. */
    public function testAPartyWithNoNameIsDropped(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification([
            'parties' => [
                ['role' => 'suspect', 'name' => ''],
                ['role' => 'witness', 'name' => '   '],
                ['role' => 'victim', 'name' => 'Maria Santos'],
            ],
        ], self::TYPES);

        $this->assertSame([['role' => 'victim', 'name' => 'Maria Santos']], $out['parties']);
    }

    /** A role outside the report's vocabulary is filed as 'other'. */
    public function testAnUnknownOrDifferentlyCasedRoleBecomesOther(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification([
            'parties' => [
                ['role' => 'VICTIM', 'name' => 'A'],
                ['role' => 'bystander', 'name' => 'B'],
            ],
        ], self::TYPES);

        $this->assertSame([
            ['role' => 'victim', 'name' => 'A'],
            ['role' => 'other', 'name' => 'B'],
        ], $out['parties']);
    }

    /**
     * The unstated list is what the officer is SHOWN — blanks carry no
     * information, so they are dropped rather than rendered as empty lines.
     */
    public function testUnstatedLinesAreTrimmedAndBlanksDropped(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification([
            'unstated' => ['  no time given  ', '', '   ', 'no suspect name given'],
        ], self::TYPES);

        $this->assertSame(['no time given', 'no suspect name given'], $out['unstated']);
    }

    /**
     * The provider's answer is the model's, and a model can return anything:
     * a number where a string belongs, a string where a list belongs, a whole
     * nested object. None of it may reach the report as anything but the type
     * the report expects.
     */
    public function testAMalformedAnswerDegradesToEmptyFieldsRatherThanCrashing(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification([
            'incidentType' => ['Theft'],
            'incidentDatetime' => 20260919,
            'location' => 42,
            'parties' => 'Maria Santos and Pedro Reyes',
            'unstated' => 'no time given',
        ], self::TYPES);

        $this->assertSame('', $out['incident_type']);
        $this->assertSame('', $out['incident_datetime']);
        $this->assertSame('', $out['location']);
        $this->assertSame([], $out['parties']);
        // The one place the answer is read TOLERANTLY rather than rejected: a
        // lone line where a list belongs is the one-line list it means. The
        // alternative — reading it as a malformed list and dropping it — would
        // throw away the only thing the officer is supposed to see.
        $this->assertSame(['no time given'], $out['unstated']);
    }

    /** Every key the report needs is present, empty or not. */
    public function testTheAnswerAlwaysCarriesEveryFieldName(): void
    {
        $out = GeminiNarrativeProvider::normaliseClassification([], self::TYPES);

        $this->assertSame([
            'incident_type', 'incident_datetime', 'incident_time_approximate',
            'location', 'reporter_name', 'reporter_contact', 'reporter_address',
            'action_taken', 'parties', 'unstated',
        ], array_keys($out));
        foreach ($out as $field => $value) {
            if ($field === 'incident_time_approximate') {
                continue;
            }
            $this->assertTrue(
                $value === [] || $value === '',
                "{$field} must be empty for an empty answer",
            );
        }
    }

    // ----------------------------------------------------------- provider guards

    /**
     * With no types there is no enum to read against, and a free-text type
     * would be rejected by the create afterwards — so the call is refused
     * BEFORE the network, and as non-retryable: retrying cannot add types.
     */
    public function testTheProviderRefusesWhenTheStationHasNoTypes(): void
    {
        $provider = new GeminiNarrativeProvider('test-key', 'gemini-test');

        $this->expectException(AiProviderException::class);
        $provider->classify('Ang biktima gidakop sa suspek.', ['types' => []]);
    }

    /** A station with no AI key reads nothing; it does not half-read an account. */
    public function testTheProviderRefusesWithoutAnApiKey(): void
    {
        $provider = new GeminiNarrativeProvider('', 'gemini-test');

        try {
            $provider->classify('Something happened.', ['types' => self::TYPES]);
            $this->fail('an unconfigured provider must refuse rather than call out');
        } catch (AiProviderException $e) {
            $this->assertFalse($e->retryable, 'a missing key is not a transient failure');
        }
    }

    // ------------------------------------------------------------ service leg

    /**
     * What the service passes down: the station's list (nothing else can
     * constrain the enum) and today's date (nothing else can resolve
     * "gahapon"). And what it hands back: the read, alongside the residual-risk
     * report — on this call there is no structured record to build an unmask
     * map from, so the officer's own words are what the model read.
     */
    public function testTheServicePassesTheTypesAndTodayAndReturnsTheRead(): void
    {
        $read = GeminiNarrativeProvider::normaliseClassification([
            'incidentType' => 'Theft',
            'location' => 'Peña Street, Barangay 5',
            'parties' => [['role' => 'complainant', 'name' => 'Maria Santos']],
            'unstated' => ['no time given'],
        ], self::TYPES);

        $stub = new StubNarrativeProvider('unused', [], $read);
        $svc = new NarrativeService($stub);

        $out = $svc->classifyAccount('Si Maria Santos nagreport sa Peña Street.', self::TYPES);

        $this->assertSame(self::TYPES, $stub->received[0]['options']['types']);
        $this->assertSame(date('Y-m-d'), $stub->received[0]['options']['today']);
        $this->assertSame('Theft', $out['fields']['incident_type']);
        $this->assertSame('Maria Santos', $out['fields']['parties'][0]['name']);
        $this->assertSame(['no time given'], $out['fields']['unstated']);
        $this->assertArrayHasKey('residualRisk', $out);
    }

    /**
     * The residual-risk scan runs on the officer's own text — and is REPORTED.
     * It is not a hidden filter: a name the officer typed is their own
     * information, and what the panel does with the nudge is the officer's
     * decision, not the service's.
     */
    public function testTheServiceReportsNamesItCouldNotHaveMasked(): void
    {
        $stub = new StubNarrativeProvider();
        $out = (new NarrativeService($stub))->classifyAccount(
            'Gikuha ni Pedro ang bag sa tindahan.',
            self::TYPES,
        );

        $this->assertContains('Pedro', $out['residualRisk']);
    }

    /**
     * The other direction of the same rule: nothing to report is an empty list,
     * not a fabricated one, and the read itself is untouched by the scan.
     */
    public function testAnAccountWithNothingToFlagReportsNothing(): void
    {
        $out = (new NarrativeService(new StubNarrativeProvider()))->classifyAccount(
            'Ang suspek misulod sa tindahan ug milayas.',
            self::TYPES,
        );

        $this->assertSame([], $out['residualRisk']);
    }

    /**
     * The stub's own default — the EMPTY read — is what the never-invent
     * contract looks like when the account states nothing useful: every field
     * present, every one empty. A service test can rely on it.
     */
    public function testTheStubDefaultIsTheEmptyRead(): void
    {
        $stub = new StubNarrativeProvider();
        $fields = $stub->classify('anything', ['types' => self::TYPES]);

        $this->assertSame('', $fields['incident_type']);
        $this->assertSame('', $fields['incident_datetime']);
        $this->assertSame('', $fields['location']);
        $this->assertSame([], $fields['parties']);
        $this->assertSame([], $fields['unstated']);
        $this->assertInstanceOf(AiNarrativeProvider::class, $stub);
    }

    // ------------------------------------------ the SECOND half: type details

    /**
     * The schema is built FROM the app's field list and pins exactly it: the
     * keys the model is asked about are the keys normaliseTypeDetails() reads
     * back, and a field this type does not have cannot come back at all. Nothing
     * is required inside it — an empty field is the honest answer, the same rule
     * the first read follows.
     */
    public function testTheTypeDetailsSchemaPinsExactlyTheTypesOwnFields(): void
    {
        $scalars = ReportRules::scalarKeysFor('Traffic Accident');
        $groups = $this->groupsFor('Traffic Accident');
        $schema = GeminiNarrativeProvider::typeDetailsSchema($scalars, $groups);

        $this->assertSame($scalars, array_keys($schema['properties']['fields']['properties']));
        $this->assertSame(array_keys($groups), array_keys($schema['properties']['groups']['properties']));
        $this->assertSame(['fields', 'groups', 'unstated'], $schema['required']);
        $this->assertArrayNotHasKey('minItems', $schema['properties']['groups']['properties']['vehicles']);

        // EVERY FREE-TEXT KEY IS REQUIRED, and may be empty. This is the rule
        // the first read has always followed and this one was missing: with the
        // keys optional a live read omitted "How property was taken" for an
        // account that says the bag was grabbed from behind — on one press but
        // not the next, at temperature 0. A required key makes the model decide
        // and SAY the empty answer instead of skipping the question.
        $required = $schema['properties']['fields']['required'];
        $this->assertContains('accident_type', $required);
        $this->assertContains('suspected_cause', $required);
        // Every group key is required too, so "no vehicles" is said rather than
        // left out.
        $this->assertSame(array_keys($groups), $schema['properties']['groups']['required']);
        // And nothing anywhere demands a VALUE: no minLength, no minItems, so
        // the honest empty answer stays available.
        foreach ($scalars as $key) {
            $this->assertArrayNotHasKey('minLength', $schema['properties']['fields']['properties'][$key]);
        }
        // A row is pinned to its own fields for the same reason the scalars are
        // pinned to the type's: a vehicle has a plate, a driver, a make/model
        // and a damage description, and nothing else.
        $this->assertSame(
            $groups['vehicles']['fields'],
            array_keys($schema['properties']['groups']['properties']['vehicles']['items']['properties']),
        );
    }

    /**
     * A mirrored scalar is a GROUP ROW seen from the flat shape —
     * `vehicle_1_plate_number` is vehicles[0].plate_number. Asking the model for
     * it would put a value in the form that the row it mirrors does not hold,
     * which is the exact disagreement syncMirrors() exists to prevent. So the
     * reading is scoped to the scalars with the mirrors removed, and the fact is
     * read from the row instead.
     */
    public function testTheTypeDetailsReadIsNeverAskedForAMirroredScalar(): void
    {
        $scalars = ReportRules::scalarKeysFor('Traffic Accident');

        foreach (['vehicle_1_plate_number', 'vehicle_1_driver', 'number_of_vehicles'] as $mirrored) {
            $this->assertNotContains($mirrored, $scalars, 'mirrors are read from their row, never asked for');
        }
        $this->assertContains('accident_type', $scalars);
        $this->assertContains('plate_number', $this->groupsFor('Traffic Accident')['vehicles']['fields']);
    }

    /**
     * The three facts only the app knows must reach the model: WHAT is being
     * read (so it does not answer the type again), the field keys with the
     * officer-facing label beside each, and TODAY — the same relative-day
     * resolution the first read gets.
     */
    public function testTheTypeDetailsInstructionCarriesTheFieldsAndToday(): void
    {
        $scalars = ReportRules::scalarKeysFor('Traffic Accident');
        $instruction = GeminiNarrativeProvider::typeDetailsInstruction(
            'Traffic Accident',
            ['scalars' => $scalars, 'groups' => $this->groupsFor('Traffic Accident')],
            '2026-09-20',
        );

        $this->assertStringContainsString('Traffic Accident', $instruction);
        foreach (array_merge($scalars, ['plate_number', 'make_model']) as $key) {
            $this->assertStringContainsString('"' . $key . '"', $instruction);
        }
        // The label is the app's own spelling of the key, so the model is told
        // what the field IS rather than left to infer it from the key.
        $this->assertStringContainsString('Accident type', $instruction);
        $this->assertStringContainsString('Vehicles Involved', $instruction);
        $this->assertStringContainsString('TODAY: 2026-09-20', $instruction);
        // And the resource file is the body, not a stub.
        $this->assertStringContainsString('Report what the account STATES', $instruction);
    }

    /**
     * A missing resource file would send no rules at all — and so would one that
     * lost the rule the reading is most likely to get wrong. Accounts describe
     * thefts the way people talk ("a sling bag containing her phone, wallet and
     * IDs"), and a prompt without these two paragraphs had a live model answer
     * `stolen_items: []` and report the contents as "unstated" while the account
     * plainly gave them.
     */
    public function testTheDetailsPromptResourceExistsAndCarriesItsTwoGoverningRules(): void
    {
        $path = dirname(__DIR__) . '/resources/ai/classification_details_prompt.txt';
        $this->assertFileExists($path);
        $prompt = (string) file_get_contents($path);
        $this->assertGreaterThan(1000, strlen($prompt));
        $this->assertStringContainsString('Report what the account STATES', $prompt);
        $this->assertStringContainsString('container', $prompt);
        $this->assertStringContainsString('A fact the account gives in PROSE is not unstated', $prompt);
        // And the how/why rule: a live model left "How property was taken"
        // empty for an account that says the bag was grabbed from behind, which
        // blocks the officer's Submit on a field the account had answered.
        $this->assertStringContainsString('HOW FIELDS ARE NOT AN EXCEPTION', $prompt);
        $this->assertStringContainsString('must never come back empty', $prompt);
    }

    /**
     * Both loops read the APP'S OWN lists, never the answer's keys — so a field
     * belonging to another type, or one the model invented, cannot reach the
     * client at all.
     */
    public function testAFieldTheReadWasNotAskedAboutIsDropped(): void
    {
        $out = GeminiNarrativeProvider::normaliseTypeDetails(
            ['fields' => [
                'accident_type' => 'head-on collision',
                'estimated_value' => '5000',      // Lost Property's field, not this type's
                'incident_type' => 'Traffic Accident', // the first read's job, not this one's
                'weather_condition' => '  ',      // present but empty — an absent field
            ]],
            ReportRules::scalarKeysFor('Traffic Accident'),
            $this->groupsFor('Traffic Accident'),
        );

        $this->assertSame(['accident_type' => 'head-on collision'], $out['fields']);
    }

    /**
     * A row is scoped the same way, and a row with nothing the type knows is not
     * a row: it is dropped rather than passed on as an empty vehicle.
     */
    public function testAGroupRowIsReducedToTheFieldsTheGroupHas(): void
    {
        $out = GeminiNarrativeProvider::normaliseTypeDetails(
            ['groups' => ['vehicles' => [
                ['plate_number' => 'ABC 1234', 'make_model' => 'Honda Wave', 'color' => 'red'],
                ['color' => 'blue', 'owner' => 'Maria'],
                ['plate_number' => '   '],
            ], 'stolen_items' => [['item_description' => 'bag']]]],
            ReportRules::scalarKeysFor('Traffic Accident'),
            $this->groupsFor('Traffic Accident'),
        );

        $this->assertSame(
            [['plate_number' => 'ABC 1234', 'make_model' => 'Honda Wave']],
            $out['groups']['vehicles'],
        );
        // A group this type does not have is never produced, whatever the
        // answer says.
        $this->assertArrayNotHasKey('stolen_items', $out['groups']);
    }

    /**
     * What the service passes down and what it hands back. The field list is
     * built HERE, from ReportRules — the caller supplies only the type — so this
     * is also the test that a new per-type field is read the moment it is added
     * to the table, with no second list to keep in step.
     */
    public function testTheServiceScopesTheReadToTheTypesOwnFields(): void
    {
        $stub = new StubNarrativeProvider('unused', [], null, [
            'fields' => ['accident_type' => 'side collision'],
            'groups' => ['vehicles' => [['plate_number' => 'ABC 1234']]],
            'unstated' => ['no driver name given'],
        ]);

        $out = (new NarrativeService($stub))->classifyTypeDetails(
            'Nabangga ang traysikel sa Balatas Road.',
            'Traffic Accident',
        );

        $sent = $stub->received[0];
        $this->assertSame('Traffic Accident', $sent['masked']['incident_type']);
        $this->assertSame(ReportRules::scalarKeysFor('Traffic Accident'), $sent['fields']['scalars']);
        $this->assertSame($this->groupsFor('Traffic Accident'), $sent['fields']['groups']);
        $this->assertSame(ReportRules::selectOptionsFor('Traffic Accident'), $sent['fields']['selects']);
        $this->assertSame(ReportRules::requiredScalarKeysFor('Traffic Accident'), $sent['fields']['required']);
        $this->assertSame(ReportRules::conditionalScalarKeysFor('Traffic Accident'), $sent['fields']['conditional']);
        $this->assertSame(date('Y-m-d'), $sent['options']['today']);
        $this->assertSame(['accident_type' => 'side collision'], $out['fields']);
        $this->assertSame([['plate_number' => 'ABC 1234']], $out['groups']['vehicles']);
        $this->assertSame(['no driver name given'], $out['unstated']);
    }

    // ------------------------------------------------- controlled vocabularies

    /**
     * The scalar fields with a controlled vocabulary, and that they are only the
     * type's OWN scalar fields. A select on a group ROW (a person's sex, which
     * also accepts "Unknown") is not a scalar and is answered through the group
     * schema, and a scalar that is a MIRROR of a row is not asked for at all.
     */
    public function testOnlyTheTypesOwnScalarsCarryAControlledVocabulary(): void
    {
        $this->assertSame(
            ['cctv_available' => ['Yes', 'No', 'Unknown']],
            ReportRules::selectOptionsFor('Theft'),
        );
        $this->assertSame(
            ['weapon_involved' => ['Yes', 'No'], 'cctv_available' => ['Yes', 'No', 'Unknown']],
            ReportRules::selectOptionsFor('Robbery'),
        );
        // Fire Incident has no select among its scalars, and most types have
        // none at all: an empty map is the ordinary case, not a failure.
        $this->assertSame([], ReportRules::selectOptionsFor('Fire Incident'));
        // Missing Person's `sex` scalar is derived from the missing-person row,
        // whose own vocabulary (Male/Female/Unknown) differs from the scalar's —
        // so the scalar is never asked for and never listed here.
        $this->assertArrayNotHasKey('sex', ReportRules::selectOptionsFor('Missing Person'));
    }

    /**
     * A vocabulary is only a constraint if the schema says so. Pinned as an enum,
     * a synonym cannot come back at all — which is the whole reason this travels
     * to the provider: a live read answered `cctv_available` with "Unconfirmed"
     * for an account that mentioned a CCTV pole, and the client's own allowlist
     * dropped it, losing the officer's CCTV evidence with nothing said.
     */
    public function testTheTypeDetailsSchemaPinsAControlledVocabularyAsAnEnum(): void
    {
        $scalars = ReportRules::scalarKeysFor('Theft');
        $selects = ReportRules::selectOptionsFor('Theft');
        $schema = GeminiNarrativeProvider::typeDetailsSchema($scalars, $this->groupsFor('Theft'), $selects);
        $props = $schema['properties']['fields']['properties'];

        $this->assertSame(['Yes', 'No', 'Unknown'], $props['cctv_available']['enum']);
        // A free-text field stays unconstrained: an enum there would refuse what
        // the account actually says.
        $this->assertArrayNotHasKey('enum', $props['location_of_property']);

        // An enum CANNOT hold an "unanswered" member — Gemini rejects an empty
        // enum value outright ("enum[3]: cannot be empty") — so there is no way
        // to answer "the account supports none of these" inside a required key.
        // Such a key is therefore the one kind that is NOT required, and its
        // absence is the empty answer. Verified against the live API: the first
        // attempt at this required every key and added an empty enum member, and
        // every call came back HTTP 400.
        $this->assertNotContains('cctv_available', $schema['properties']['fields']['required']);
        $this->assertNotContains('', $props['cctv_available']['enum']);
    }

    /**
     * And the same list has to reach the model in words, because a field the
     * model cannot see is a field it answers from instinct. It travels as its
     * own JSON block so the field list stays a list of names.
     */
    public function testTheTypeDetailsInstructionCarriesTheAllowedValues(): void
    {
        $instruction = GeminiNarrativeProvider::typeDetailsInstruction(
            'Theft',
            $this->form('Theft'),
            '2026-09-20',
        );

        // The QUOTED form is the JSON block's own key: the prompt file names the
        // block in backticks, so only the block itself can match this.
        $this->assertStringContainsString('"fields_that_take_one_of_these_values"', $instruction);
        // The key is the contract (it is what the answer must use and what
        // normaliseTypeDetails reads back); the label beside it is humanise()d
        // from the key, so it is the KEY the assertion pins.
        $this->assertStringContainsString('"cctv_available"', $instruction);
        $this->assertStringContainsString('"Unknown"', $instruction);
        // The vocabulary block is omitted when there is nothing to constrain,
        // rather than sent empty: an empty list would read as "no value is
        // allowed". Both levels are checked, since the block also rides inside a
        // group's entry now — a stolen-items group has no vocabulary at all.
        $bare = GeminiNarrativeProvider::typeDetailsInstruction(
            'Fire Incident',
            [
                'scalars' => ReportRules::scalarKeysFor('Fire Incident'),
                'groups' => ['stolen_items' => ['label' => 'Stolen Items', 'fields' => ['item_description']]],
            ],
            '2026-09-20',
        );
        $this->assertStringNotContainsString('"fields_that_take_one_of_these_values"', $bare);
    }

    /**
     * The fields the report CANNOT be filed without are named as such, and the
     * conditional ones carry the value that switches them on. This is the nudge
     * a live read needs: it filled "How property was taken" on one press and
     * skipped the same field on the next for the same account, and an officer
     * cannot file around a field that comes and goes.
     *
     * Mirrored scalars are NOT in the required list — Theft's "Item" is
     * stolen_items[0] seen flat, derived from a group row this same read is
     * asked for, so asking for it again would put a value in the field the row
     * does not hold.
     */
    public function testTheTypeDetailsInstructionNamesWhatTheReportCannotBeFiledWithout(): void
    {
        $required = ReportRules::requiredScalarKeysFor('Theft');
        $this->assertContains('how_property_was_taken', $required);
        $this->assertNotContains('item_stolen', $required, 'a mirrored scalar is derived, not asked for');

        // Robbery carries both shapes: weapon_involved is required, and
        // weapon_description becomes required only once it is answered "Yes".
        // Its own TYPE_CONDITIONAL also names cctv_description, which Robbery
        // does NOT have as a field — so it is dropped here rather than sent to
        // the model as a phantom.
        $this->assertSame(
            ['weapon_description' => ['weapon_involved' => ['Yes']]],
            ReportRules::conditionalScalarKeysFor('Robbery'),
        );

        $instruction = GeminiNarrativeProvider::typeDetailsInstruction(
            'Robbery',
            $this->form('Robbery'),
            '2026-09-20',
        );
        $this->assertStringContainsString('"fields_the_report_cannot_be_filed_without"', $instruction);
        $this->assertStringContainsString('"weapon_involved"', $instruction);
        $this->assertStringContainsString('"fields_required_only_when"', $instruction);
        $this->assertStringContainsString('"weapon_description"', $instruction);
    }

    /**
     * A field the reading is not asked about must never appear in a constraint
     * block, whatever the table says: a phantom field in front of the model is
     * an answer the app cannot carry. Checked by handing the instruction a
     * required list naming a mirror and a field of another type.
     */
    public function testAConstraintNamingSomethingThisReadCannotAnswerIsDropped(): void
    {
        $instruction = GeminiNarrativeProvider::typeDetailsInstruction(
            'Theft',
            [
                'scalars' => ReportRules::scalarKeysFor('Theft'),
                'groups' => $this->groupsFor('Theft'),
                'required' => ['how_property_was_taken', 'item_stolen', 'entry_point'],
                'conditional' => ['entry_point' => ['signs_of_forced_entry' => ['Yes']]],
            ],
            '2026-09-20',
        );

        $this->assertStringContainsString('"how_property_was_taken"', $instruction);
        $this->assertStringNotContainsString('item_stolen', $instruction);
        $this->assertStringNotContainsString('entry_point', $instruction);
        $this->assertStringNotContainsString('"fields_required_only_when"', $instruction);
    }

    /**
     * The vocabularies INSIDE a group's rows travel the same way the incident's
     * own do, and for the same reason: a live read of a rape report answered a
     * victim row's `injury_status` with the account's prose ("bruises on her left
     * arm and a scratch on her neck") and a suspect row's `suspect_status` with
     * "At large", neither of which the row accepts — so the client's allowlist
     * dropped both and the officer saw rows silently missing what the account had
     * said. Pinned as an enum, the coded fields come back as the values the form
     * actually carries ("Minor Injury", "Identified").
     */
    public function testGroupRowVocabulariesArePinnedInTheSchemaAndSentToTheModel(): void
    {
        $type = 'Rape / Sexual Assault';
        $vocabulary = ReportRules::groupSelectOptionsFor($type);
        $this->assertSame(
            ['Uninjured', 'Minor Injury', 'Serious Injury', 'Deceased'],
            $vocabulary['complainant']['injury_status'],
        );
        $this->assertSame(['Unidentified', 'Identified'], $vocabulary['respondent']['suspect_status']);

        $schema = GeminiNarrativeProvider::typeDetailsSchema(
            ReportRules::scalarKeysFor($type),
            $this->groupsFor($type),
            ReportRules::selectOptionsFor($type),
        );
        $rowProps = $schema['properties']['groups']['properties']['complainant']['items']['properties'];
        $this->assertSame($vocabulary['complainant']['injury_status'], $rowProps['injury_status']['enum']);
        // A free-text row field stays unconstrained.
        $this->assertArrayNotHasKey('enum', $rowProps['name']);

        $instruction = GeminiNarrativeProvider::typeDetailsInstruction($type, $this->form($type), '2026-09-20');
        $this->assertStringContainsString('"victim_type"', $instruction);
        $this->assertStringContainsString('"Serious Injury"', $instruction);
    }

    /**
     * A group whose rows are free text throughout is not sent an empty
     * vocabulary block — an empty list would read as "no value is allowed".
     */
    public function testAGroupWithoutARowVocabularyGetsNoBlock(): void
    {
        $vocabulary = ReportRules::groupSelectOptionsFor('Lost Property');
        $this->assertArrayHasKey('complainant', $vocabulary);
        $this->assertArrayNotHasKey('stolen_items', $vocabulary, 'a free-text group is absent, not empty');
        $this->assertArrayNotHasKey('vehicles', ReportRules::groupSelectOptionsFor('Traffic Accident'));
        $this->assertArrayHasKey('injured_persons', ReportRules::groupSelectOptionsFor('Traffic Accident'));
    }

    /**
     * A type the app has no field list for has nothing to read against — the
     * legacy Phase 1/2 spellings are the case in point. The provider refuses
     * rather than returning an empty answer, because an empty answer would look
     * like a successful read of a form that does not exist.
     */
    public function testTheTypeDetailsReadRefusesATypeWithNoFieldList(): void
    {
        $this->assertSame([], ReportRules::scalarKeysFor('Vehicular Accident'));
        $this->assertNull(ReportRules::groupsFor('Vehicular Accident'));

        $this->expectException(AiProviderException::class);
        (new NarrativeService(new StubNarrativeProvider()))->classifyTypeDetails(
            'May banggaan sa kalsada.',
            'Vehicular Accident',
        );
    }
}
