<?php
// PHPUnit bootstrap for the BlueWrite API test suite (Item 4).
declare(strict_types=1);

require __DIR__ . '/BaseApiTestCase.php';

// A core class a test reaches IN-PROCESS through a provider — the API server has
// its own require list in api/index.php, PHPUnit has none. Loaded here rather
// than inside the one file that needs it so the suite is order-independent:
// SystemInstructionTest calls GeminiNarrativeProvider::buildRequestBody() and
// used to fail with 'Class "App\Core\LanguageRegistry" not found' whenever it
// happened to run before LanguageRegistryTest.php loaded the file itself.
require_once __DIR__ . '/../app/core/LanguageRegistry.php';

// Same reason, same place: MaskingGateway::buildMaskedPayload() names a report's
// incident types through IncidentTypes::label(), and the AI tests reach that in
// process. One require here keeps the suite order-independent.
require_once __DIR__ . '/../app/core/IncidentTypes.php';
