import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelReportDetail } from "../src/components/FreeModelReports";
import { providerReportCsv, providerReportHtml } from "../src/lib/modelReportExport";
import { completeModelReport, parseReportRange, summarizeModelReports } from "../../../services/api/src/tagflowReports.ts";
import { DEFAULT_TAGFLOW_CONFIG } from "../../../services/api/src/tagflowConfig.ts";
import type { ModelRequestRecord } from "../../../services/api/src/tagflowReportTypes.ts";

const at = Date.parse("2026-10-11T12:00:00Z");
const row: ModelRequestRecord = { id:"11111111-1111-4111-8111-111111111111",uid:"PRIVATE-ACCOUNT",modelId:"=HYPERLINK(1)",modelName:"<script>alert('model')</script>",provider:"tagflow",upstreamModel:"coder",startedAt:at-1000,finishedAt:at,providerStartedAt:at-1000,outcome:"success",errorCode:null,upstreamStatus:200,source:"chat",streamed:true,toolsOffered:true,toolCalls:1,finishReason:"stop",contextWindow:131072,requestedOutput:4096,estimatedInput:100,inputTokens:100,outputTokens:10,costMicros:10,estimated:false,durationMs:1000,firstTokenMs:100 };
const range = parseReportRange("2026-10-11","2026-10-11",at)!;
const report = completeModelReport(summarizeModelReports([row],[{ requestId:row.id,uid:row.uid,rating:"helpful",category:"quality",comment:"<img src=x onerror=alert(1)> @private",shareWithProvider:true,createdAt:at-100,updatedAt:at-100 }],range,at-2000),{ ...DEFAULT_TAGFLOW_CONFIG,models:[] },range,at);

describe("provider-ready exports",() => {
  it("exports complete aggregates and definitions while escaping all user-authored HTML",() => {
    const html = providerReportHtml(report);
    expect(html).toContain("Daily demand and usage"); expect(html).toContain("Demand, usage and capacity"); expect(html).toContain("Feedback and quality signals"); expect(html).toContain("Definitions and data limitations"); expect(html).toContain("partial historical coverage");
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<img src=x"); expect(html).toContain("&lt;img"); expect(html).not.toContain("PRIVATE-ACCOUNT");
    expect(html).toContain("Response latency p95"); expect(html).toContain("Observed output rate p50");
  });
  it("prevents spreadsheet formulas and exports a rectangular full-data CSV",() => {
    const csv = providerReportCsv(report);
    expect(csv).toContain("' =HYPERLINK".replace("' ","'")); expect(csv).not.toContain("PRIVATE-ACCOUNT");
    expect(csv).toContain('"definition"'); expect(csv).toContain('"shared_comment"'); expect(csv).toContain('"daily"');
    expect(csv).toContain('"current"'); expect(csv).toContain('"previous"');
  });
  it("renders actual values and unavailable samples without fabricated percentages",() => {
    const markup = renderToStaticMarkup(<ModelReportDetail model={report.models[0]!} report={report} />);
    expect(markup).toContain("Request demand"); expect(markup).toContain("Provider error rate"); expect(markup).toContain("100.0%"); expect(markup).toContain("Not measured"); expect(markup).toContain("11.11");
    expect(markup).not.toContain("<script>"); expect(markup).toContain("Daily model metrics"); expect(markup).toContain("Full model metrics");
  });
  it("includes audience and configured capacity in screen, HTML and CSV without account IDs",() => {
    const profiles = new Map([[row.uid,{ uid:row.uid,role:"student" as const,experience:"beginner" as const,primaryUse:"learning" as const,updatedAt:at }]]);
    const audienceReport = completeModelReport({ ...summarizeModelReports([{ ...row,country:"IN",aiPersona:"reviewer",useCase:"code-review",platform:"win32" }],[],range,at-2000,profiles),audienceStartedAt:at-2000 },{ ...DEFAULT_TAGFLOW_CONFIG,enabled:true,models:[{ id:row.modelId,name:row.modelName,upstreamModel:row.upstreamModel,contextWindow:262144,maxOutput:4096,inputPrice:0,outputPrice:0 }] },range,at);
    const html = providerReportHtml(audienceReport), csv = providerReportCsv(audienceReport), markup = renderToStaticMarkup(<ModelReportDetail model={audienceReport.models[0]!} report={audienceReport} />);
    for (const output of [html,markup]) { expect(output).toContain("256k"); expect(output).toContain("262,144"); expect(output).toContain("India"); expect(output).toContain("Student"); expect(output).toContain("Reviewer"); expect(output).toContain("Learning"); expect(output).toContain("100.0% coverage"); expect(output).not.toContain("PRIVATE-ACCOUNT"); }
    expect(csv).toContain('"audience"'); expect(csv).toContain('"configuration"'); expect(csv).toContain('"audience_started_at"'); expect(csv).toContain('"countries","IN","India"'); expect(csv).not.toContain("PRIVATE-ACCOUNT");
  });
});
