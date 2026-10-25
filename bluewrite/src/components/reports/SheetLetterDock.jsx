// The sheet's bondpaper with its ribbon, drawn wherever the letter's home
// is: the card in the deck formats, or the paper's own mount under the
// narrative in the sheet's slim bar. One copy — the portal branch and the
// card branch render this same element, so typing, gating and reveal never
// drift between homes. A pure presentational component: no state of its own.
//
// Order is the contract: the ribbon docks directly above `.print-sheet` —
// never a panel per section, never on the text. The ribbon shows while the
// sheet is editable and dims until a prose editor holds the caret; the
// fullscreen preview stays read-only and never mounts this dock.

import React from 'react';
import ReportSheetBody from './ReportSheetBody.jsx';
import SheetToolBox from './SheetToolBox.jsx';

export default function SheetLetterDock({
  sheet,
  pending,
  revealPending,
  revealKey,
  onRevealComplete,
  onProgress,
  viewportRef,
  editable,
  onEditNarrative,
  onEditFindings,
  onEditAction,
  onEditFact,
  onEditChrome,
  letterHtml,
  onEditLetterHtml,
}) {
  return (
    <div className="sheet-ribbon-dock">
      <SheetToolBox enabled={!!editable} />
      <div
        // MEASURED, NOT DRESSED: it draws nothing of its own, so the
        // paper's edge stays the only box the officer sees.
        className="ai-sheet-preview"
        ref={viewportRef}
      >
        <div className="print-sheet">
          <ReportSheetBody
            report={sheet.report}
            ts={sheet.ts}
            stationHeader={sheet.stationHeader}
            pending={pending}
            editable={editable}
            onEditNarrative={onEditNarrative}
            onEditFindings={onEditFindings}
            onEditAction={onEditAction}
            onEditFact={onEditFact}
            onEditChrome={onEditChrome}
            letterHtml={letterHtml}
            onEditLetterHtml={onEditLetterHtml}
            // A draft restored in this tab arrives WHOLE: the officer has
            // already watched it land once, and a replay would have the
            // panel acting out work it is only remembering.
            revealPending={revealPending}
            // A new generation replays the typing from the top.
            revealKey={revealKey}
            onRevealComplete={onRevealComplete}
            // Task 10 — the frame follows the words (see AiNarrativePanel).
            onProgress={onProgress}
          />
        </div>
      </div>
    </div>
  );
}
