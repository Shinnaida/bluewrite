<mxfile host="app.diagrams.net" pages="2">
  <diagram name="W1" id="workflow-w1">
    <mxGraphModel dx="1423" dy="855" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="816" pageHeight="1056" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="W1_start" locked="1" parent="1" style="ellipse;whiteSpace=wrap;html=1;fontSize=11;fontStyle=1;strokeWidth=2;fillColor=none;" value="START" vertex="1">
          <mxGeometry height="56" width="200" x="313" y="40" as="geometry" />
        </mxCell>
        <mxCell id="W1_reported" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Incident / Complaint is Reported" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="120" as="geometry" />
        </mxCell>
        <mxCell id="W1_desk" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Desk Officer Receives the Report" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="214" as="geometry" />
        </mxCell>
        <mxCell id="W1_logbook" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Write the blotter entry in the log book" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="308" as="geometry" />
        </mxCell>
        <mxCell id="W1_find" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Find a similar incident format file on the PC" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="402" as="geometry" />
        </mxCell>
        <mxCell id="W1_word" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Open Microsoft Word and duplicate the similar file" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="496" as="geometry" />
        </mxCell>
        <mxCell id="W1_encode" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Create a new report and encode the log-book text" vertex="1">
          <mxGeometry height="76" width="300" x="263" y="590" as="geometry" />
        </mxCell>
        <mxCell id="W1_review" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Review encoded report for completeness and accuracy" vertex="1">
          <mxGeometry height="76" width="300" x="263" y="690" as="geometry" />
        </mxCell>
        <mxCell id="W1_q" locked="1" parent="1" style="rhombus;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Report complete &amp; correct?" vertex="1">
          <mxGeometry height="112" width="123" x="351.5" y="790" as="geometry" />
        </mxCell>
        <mxCell id="W1_revise" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Revise or Add Missing Information" vertex="1">
          <mxGeometry height="70" width="220" x="540" y="811" as="geometry" />
        </mxCell>
        <mxCell id="W1_next" locked="1" parent="1" style="shape=offPageConnector;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="1" vertex="1">
          <mxGeometry height="40" width="47" x="389.5" y="926" as="geometry" />
        </mxCell>
        <mxCell id="W1E1" edge="1" locked="1" parent="1" source="W1_start" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_reported">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E2" edge="1" locked="1" parent="1" source="W1_reported" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_desk">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E3" edge="1" locked="1" parent="1" source="W1_desk" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_logbook">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E4" edge="1" locked="1" parent="1" source="W1_logbook" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_find">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E5" edge="1" locked="1" parent="1" source="W1_find" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_word">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E6" edge="1" locked="1" parent="1" source="W1_word" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_encode">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E7" edge="1" locked="1" parent="1" source="W1_encode" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_review">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E8" edge="1" locked="1" parent="1" source="W1_review" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_q">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E9" edge="1" locked="1" parent="1" source="W1_q" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=1;exitY=0.5;entryX=0;entryY=0.5;" target="W1_revise" value="No">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E10" edge="1" locked="1" parent="1" source="W1_revise" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=0;entryX=1;entryY=0.5;" target="W1_review">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W1E11" edge="1" locked="1" parent="1" source="W1_q" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W1_next" value="Yes">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
  <diagram name="W2" id="workflow-w2">
    <mxGraphModel dx="1423" dy="855" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="816" pageHeight="1056" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="W2_top" locked="1" parent="1" style="shape=offPageConnector;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="1" vertex="1">
          <mxGeometry height="40" width="47" x="389.5" y="40" as="geometry" />
        </mxCell>
        <mxCell id="W2_submit" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Submit Report to Supervisor / Reviewing Officer" vertex="1">
          <mxGeometry height="76" width="300" x="263" y="104" as="geometry" />
        </mxCell>
        <mxCell id="W2_super" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Supervisor Reviews and Validates the Report" vertex="1">
          <mxGeometry height="76" width="300" x="263" y="204" as="geometry" />
        </mxCell>
        <mxCell id="W2_q" locked="1" parent="1" style="rhombus;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Report approved?" vertex="1">
          <mxGeometry height="112" width="123" x="351.5" y="304" as="geometry" />
        </mxCell>
        <mxCell id="W2_correct" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Return Report for Correction" vertex="1">
          <mxGeometry height="70" width="200" x="40" y="325" as="geometry" />
        </mxCell>
        <mxCell id="W2_revise" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Revise Report" vertex="1">
          <mxGeometry height="70" width="200" x="40" y="440" as="geometry" />
        </mxCell>
        <mxCell id="W2_final" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Finalize Incident Report" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="440" as="geometry" />
        </mxCell>
        <mxCell id="W2_print" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="Print and Sign Report" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="534" as="geometry" />
        </mxCell>
        <mxCell id="W2_file" locked="1" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fontSize=11;strokeWidth=2;fillColor=none;" value="File / Store Report in Records" vertex="1">
          <mxGeometry height="70" width="300" x="263" y="628" as="geometry" />
        </mxCell>
        <mxCell id="W2_end" locked="1" parent="1" style="ellipse;whiteSpace=wrap;html=1;fontSize=11;fontStyle=1;strokeWidth=2;fillColor=none;" value="END" vertex="1">
          <mxGeometry height="56" width="200" x="313" y="722" as="geometry" />
        </mxCell>
        <mxCell id="W2E1" edge="1" locked="1" parent="1" source="W2_top" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_submit">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E2" edge="1" locked="1" parent="1" source="W2_submit" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_super">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E3" edge="1" locked="1" parent="1" source="W2_super" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_q">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E4" edge="1" locked="1" parent="1" source="W2_q" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0;exitY=0.5;entryX=1;entryY=0.5;" target="W2_correct" value="No">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E5" edge="1" locked="1" parent="1" source="W2_correct" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_revise">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E6" edge="1" locked="1" parent="1" source="W2_revise" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0;exitY=0.5;entryX=0;entryY=0.5;" target="W2_super">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E7" edge="1" locked="1" parent="1" source="W2_q" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_final" value="Yes">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E8" edge="1" locked="1" parent="1" source="W2_final" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_print">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E9" edge="1" locked="1" parent="1" source="W2_print" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_file">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="W2E10" edge="1" locked="1" parent="1" source="W2_file" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;fontSize=11;fillColor=none;exitX=0.5;exitY=1;entryX=0.5;entryY=0;" target="W2_end">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
