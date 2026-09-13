# Narrative few-shot examples

Masked example narratives per incident-type category. The provider includes
the matching category block (or GENERIC) in the request. Placeholders follow
the MaskingGateway format; the people are fictional.

## GENERIC

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "30s", "sex": "Female", "injury_status": "Uninjured"}], "suspects": [{"ref": "[RESPONDENT_1]"}]}
```
OFFICER NOTES:
```
bag snatched sa market, around 2pm. victim shouted, suspect ran sa highway
```
NARRATIVE:
On [WHEN], [VICTIM_1] was walking in the vicinity of [LOCATION] when an unidentified man, hereinafter referred to as [RESPONDENT_1], forcibly snatched the bag she was carrying. [VICTIM_1] shouted for help, drawing the attention of nearby vendors, whereupon [RESPONDENT_1] fled on foot toward the highway. Responding personnel arrived shortly thereafter and conducted an initial interview with [VICTIM_1], who executed a sworn statement regarding the incident. A follow-up investigation was immediately initiated to identify and locate [RESPONDENT_1].

## TRAFFIC ACCIDENT

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "40s", "sex": "Male", "injury_status": "Minor Injury"}], "vehicles": [{"ref": "[VEHICLE_1]", "plate_ref": "[VEHICLE_1_PLATE]", "driver_ref": "[VEHICLE_1_DRIVER]", "make_model": "Toyota Vios"}, {"ref": "[VEHICLE_2]", "plate_ref": "[VEHICLE_2_PLATE]", "driver_ref": "[VEHICLE_2_DRIVER]", "make_model": "Motorcycle"}]}
```
OFFICER NOTES:
```
collision sa intersection, motorcycle hit sedan side. rider minor injuries, brought to hospital
```
NARRATIVE:
On [WHEN], a traffic accident occurred at the intersection along [LOCATION] involving [VEHICLE_1], a sedan driven by [VEHICLE_1_DRIVER], and [VEHICLE_2], a motorcycle driven by [VEHICLE_2_DRIVER]. Initial investigation disclosed that the motorcycle sideswiped the sedan's rear door as both vehicles traversed the intersection. As a result, [VICTIM_1], the motorcycle rider, sustained minor injuries and was immediately brought to the nearest medical facility for treatment. Both vehicles sustained damage and were subsequently moved to the roadside to clear the flow of traffic. Responding personnel documented the scene, took photographs, and obtained the statements of both drivers for the traffic accident report.

## THEFT / ROBBERY

STRUCTURED FIELDS:
```json
{"victims": [{"ref": "[VICTIM_1]", "age_band": "50s", "sex": "Male"}], "suspects": [{"ref": "[RESPONDENT_1]"}, {"ref": "[RESPONDENT_2]"}], "witnesses": [{"ref": "[WITNESS_1]"}]}
```
OFFICER NOTES:
```
two men entered store, one held guard, other took cash box. cctv captured faces
```
NARRATIVE:
On [WHEN], a robbery incident transpired at [LOCATION]. [RESPONDENT_1] and [RESPONDENT_2], acting in concert, entered the establishment; while [RESPONDENT_1] restrained the establishment's security guard, [RESPONDENT_2] took the cash box containing an undetermined amount of money. [VICTIM_1], the store owner, was present during the incident and was unharmed. [WITNESS_1], a bystander, witnessed the entire course of the event. Both suspects fled on board a waiting motorcycle toward an unknown direction. Responding personnel secured the premises, recovered closed-circuit television footage showing the faces of the perpetrators, and initiated a hot-pursuit operation.
