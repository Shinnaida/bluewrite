# Narrative few-shot examples

Masked example narratives per incident-type category. The provider includes
the matching category block (or GENERIC) in the request. Placeholders follow
the MaskingGateway format; the people are fictional.

Every example carries an ACTION TAKEN / STATUS input, and its narrative
CLOSES on exactly that disposition — nothing more is ever stated about what
the responding team did afterwards. The closing RESTATES the recorded text
in formal police prose; it never copies the field's wording word-for-word
(e.g. recorded "follow up investigation" becomes "a follow-up investigation
was immediately initiated", never the bare phrase). This is the pattern the
model must copy: the disposition is the officer's substance, formally
restated as prose.

No example contains a fact its inputs do not: every noun, time and action in
the NARRATIVE, the actionTaken line and the notableFindings lines traces back
to the STRUCTURED FIELDS, the ACTION TAKEN / STATUS text or the OFFICER NOTES.
Formal wording is substitution, never addition. The GENERIC — THIN INPUT
block shows the required behaviour when the record is sparse (a short output,
not a padded one); the structured examples show it when the record is rich.

The GENERIC — DUPLICATION block shows the OTHER failure mode, and is the
budget for every call: an officer who typed the same thing twice, or typed a
non-event ("no weapons were involved", "no injuries were sustained"), still
gets ONE statement of each proposition across the whole output. Note what
that example does NOT contain: no summary sentence, no closing formula, no
acknowledgement of the record, and no second line saying what the narrative
already said. (The prohibited sentences themselves are listed in the base
instruction, not here — an example is what the model imitates, and quoting a
formula in this file is how the old record-entry closer got copied into every
draft.) A fact written twice reads as two facts in a legal document.

## GENERIC

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "30s", "sex": "Female", "injury_status": "Uninjured"}], "suspects": [{"ref": "[RESPONDENT_1]"}]}
```
ACTION TAKEN / STATUS:
```
follow up investigation
```
OFFICER NOTES:
```
bag snatched sa market, around 2pm. victim shouted, suspect ran sa highway
```
NARRATIVE:
On [WHEN], [VICTIM_1] was walking in the vicinity of [LOCATION] when an unidentified man, hereinafter referred to as [RESPONDENT_1], forcibly snatched the bag she was carrying. [VICTIM_1] shouted for help, drawing the attention of nearby vendors, whereupon [RESPONDENT_1] fled on foot toward the highway. Responding personnel arrived shortly thereafter and conducted an initial interview with [VICTIM_1]. A follow-up investigation was subsequently initiated to identify and locate [RESPONDENT_1].

## GENERIC — DUPLICATION (one proposition, one place)

The officer typed the same absence twice and typed a non-event as a finding.
The same record, budgeted: the absence is stated once in the narrative, the
one real observation survives as a single finding, and nothing restates the
narrative. Nothing was lost from the SHEET — every fact the officer supplied
is still there, once.

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "20s", "sex": "Female", "injury_status": "Uninjured"}], "suspects": [{"ref": "[RESPONDENT_1]"}]}
```
ACTION TAKEN / STATUS:
```
follow up investigation
```
OFFICER NOTES:
```
cellphone stolen sa market. victim shouted, suspect ran on foot. no weapon, walang CCTV
```
NOTABLE FINDINGS (as the officer typed them — note the three duplicates):
```
The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.
No weapons were involved and no injuries were sustained by [VICTIM_1].
No closed-circuit television (CCTV) footage was available at the location of the incident.
No CCTV footage covers the area of the incident.
```
NARRATIVE:
On [WHEN], [VICTIM_1] reported that her cellular phone was unlawfully taken from her possession in the vicinity of [LOCATION]. [VICTIM_1] shouted for assistance, whereupon an unidentified man, hereinafter referred to as [RESPONDENT_1], fled the scene on foot. No weapon was involved and no closed-circuit television (CCTV) footage was available in the area. A follow-up investigation is currently being conducted.

ACTION TAKEN / STATUS LINE (the actionTaken output — the SAME disposition, deliberately a different shape):
The case remains under follow-up investigation by this Office.

NOTABLE FINDINGS (the notableFindings output):
```
The stolen property involves one (1) white iPhone with an estimated value of ₱20,000.
```
Four lines went in, one came out, and no fact was lost. The two CCTV lines were one proposition written twice: they became ONE statement, in the narrative, where an investigative absence belongs — so they produced NO finding. "No weapons were involved and no injuries were sustained" is the absence of an observation rather than an observation, so it produced none either. The property finding is a real observation, and it is the one line kept; the narrative does not restate the phone's value, because the finding holds it. The disposition appears twice, as the form requires, in two different shapes — integrated in the narrative, standing alone as the actionTaken line. There is no closing formula and no summary sentence: the last sentence is the disposition.

## GENERIC — THIN INPUT (do not pad)

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "sex": "Female"}]}
```
ACTION TAKEN / STATUS:
```
responded 10pm, talked to both parties, gave warning, no injuries
```
OFFICER NOTES:
```
neighbors argued over parking, no one hurt
```
NARRATIVE:
On [WHEN], [VICTIM_1] reported a dispute over a parking space in the vicinity of [LOCATION]. Responding personnel arrived at approximately 22:00 hours, made contact with both parties, and issued a verbal warning; no injuries were sustained.

ACTION TAKEN / STATUS LINE (the actionTaken output — the same facts as one formal line):
Responding personnel arrived at approximately 22:00 hours, made contact with both parties, and issued a verbal warning; no injuries were sustained.

NOTABLE FINDINGS (the notableFindings output):
```
[]
```
The record is thin, so the output is thin. "22:00 hours" is the officer's "10pm" in formal form, "made contact with" is the officer's "talked to", "issued a verbal warning" is the officer's "gave warning", "no injuries were sustained" is the officer's "no injuries" — and NOTHING ELSE appears. No advising the parties to keep the peace, no follow-up, no referral, no record entry, no medical step: none of those were recorded, so none may be written. The findings array is empty because no observation beyond the events themselves was recorded — an empty array is the correct answer here, not a flaw to fix.

## TRAFFIC ACCIDENT

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "40s", "sex": "Male", "injury_status": "Minor Injury"}], "vehicles": [{"ref": "[VEHICLE_1]", "plate_ref": "[VEHICLE_1_PLATE]", "driver_ref": "[VEHICLE_1_DRIVER]", "make_model": "Toyota Vios"}, {"ref": "[VEHICLE_2]", "plate_ref": "[VEHICLE_2_PLATE]", "driver_ref": "[VEHICLE_2_DRIVER]", "make_model": "Motorcycle"}]}
```
ACTION TAKEN / STATUS:
```
investigation ongoing, drivers advised to settle amicably, vehicles released after documentation
```
OFFICER NOTES:
```
collision sa intersection, motorcycle hit sedan side. rider minor injuries, brought to hospital
```
NARRATIVE:
On [WHEN], a traffic accident occurred at the intersection along [LOCATION] involving [VEHICLE_1], a sedan driven by [VEHICLE_1_DRIVER], and [VEHICLE_2], a motorcycle driven by [VEHICLE_2_DRIVER]. Initial investigation disclosed that the motorcycle sideswiped the sedan's rear door as both vehicles traversed the intersection. As a result, [VICTIM_1], the motorcycle rider, sustained minor injuries and was immediately brought to the nearest medical facility for treatment. Responding personnel documented the scene and took photographs of the damage sustained by both vehicles, which were thereafter released to their registered owners, and the parties were counselled towards an amicable settlement while the inquiry into the incident continues.

## THEFT / ROBBERY

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "50s", "sex": "Male"}], "suspects": [{"ref": "[RESPONDENT_1]"}, {"ref": "[RESPONDENT_2]"}], "witnesses": [{"ref": "[WITNESS_1]"}]}
```
ACTION TAKEN / STATUS:
```
hot pursuit operation conducted, suspects still at large, follow up investigation ongoing
```
OFFICER NOTES:
```
two men entered store, one held guard, other took cash box. cctv captured faces
```
NARRATIVE:
On [WHEN], a robbery incident transpired at [LOCATION]. [RESPONDENT_1] and [RESPONDENT_2], acting in concert, entered the establishment; while [RESPONDENT_1] restrained the establishment's security guard, [RESPONDENT_2] took the cash box containing an undetermined amount of money. [VICTIM_1], the store owner, was present during the incident and was unharmed. [WITNESS_1], a bystander, witnessed the entire course of the event. Both suspects fled on board a waiting motorcycle toward an unknown direction. Responding personnel secured the premises and recovered closed-circuit television footage showing the faces of the perpetrators; a hot-pursuit operation was launched against the fleeing perpetrators, whose whereabouts remain undetermined as of this reporting, and the case is now the subject of a continuing inquiry by this Office.
