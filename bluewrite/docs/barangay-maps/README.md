# Barangay Spot Maps — City of Naga, Cebu (offline copy)

Official spot maps for all **28 barangays**, saved here so the station can
pinpoint places with no internet (the station LAN is offline).

- **Source:** [Barangay Maps of the City of Naga](https://cityofnagacebu.gov.ph/barangay-map-of-the-city-of-naga/)
  (City of Naga official website)
- **Fetched:** November 2026. Each file is the city's own one-page PDF:
  location map + zoomed barangay inset + facility legend.
- **Use:** open the PDF of the barangay named in the report
  (e.g. `Inoburan-Naga-Spot-Map.pdf`) and match the scene against it.
- These maps label **barangays and facilities, not sitios/puroks** —
  a sitio name (e.g. Cangimundong in Inoburan) will not appear on them.
  Sitio-level pinpointing still needs the barangay hall's purok roll.

| # | Barangay | File |
|---|----------|------|
| 1 | Alfaco (city site spells "Alpaco") | `Alpaco-Naga-Spot-Map.pdf` |
| 2 | Bairan | `Bairan-Naga-Spot-Map.pdf` |
| 3 | Balirong | `Balirong-Naga-Spot-Map.pdf` |
| 4 | Cabungahan | `Cabungahan-Naga-Spot-Map.pdf` |
| 5 | Cantao-an | `Cantao-an-Naga-Spot-Map.pdf` |
| 6 | Central Poblacion | `Central-Pob-Naga-Spot-Map.pdf` |
| 7 | Cogon | `Cogon-Naga-Spot-Map.pdf` |
| 8 | Colon | `Colon-Naga-Spot-Map.pdf` |
| 9 | East Poblacion | `East-Pob-Naga-Spot-Map.pdf` |
| 10 | Inayagan | `Inayagan-Naga-Spot-Map.pdf` |
| 11 | Inoburan | `Inoburan-Naga-Spot-Map.pdf` |
| 12 | Jaguimit | `Jaguimit-Naga-Spot-Map.pdf` |
| 13 | Lanas | `Lanas-Naga-Spot-Map.pdf` |
| 14 | Langtad | `Langtad-Naga-Spot-Map.pdf` |
| 15 | Lutac | `Lutac-Naga-Spot-Map.pdf` |
| 16 | Mainit | `Mainit-Naga-Spot-Map.pdf` |
| 17 | Mayana | `Mayana-Naga-Spot-Map.pdf` |
| 18 | Naalad | `Naalad-Naga-Spot-Map.pdf` |
| 19 | North Poblacion | `North-Pob-Naga-Spot-Map.pdf` |
| 20 | Pangdan | `Pangdan-Naga-Spot-Map.pdf` |
| 21 | Patag | `Patag-Naga-Spot-Map.pdf` |
| 22 | South Poblacion | `South-Pob-Naga-Spot-Map.pdf` |
| 23 | Tagjaguimit | `Tagjaguimit-Naga-Spot-Map.pdf` |
| 24 | Tangke | `Tangke-Naga-Spot-Map.pdf` |
| 25 | Tinaan | `Tinaan-Naga-Spot-Map.pdf` |
| 26 | Tuyan | `Tuyan-Naga-Spot-Map.pdf` |
| 27 | Uling | `Uling-Naga-Spot-Map.pdf` |
| 28 | West Poblacion | `Westl-Pob-Naga-Spot-Map.pdf` (filename typo is the city's own) |

Related code: the app's offline place gazetteer (`src/lib/nagaPlaces.js`)
uses these same 28 names to auto-match near-miss barangay spellings.
