import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  FileText,
  Clipboard,
  ClipboardCheck,
  Loader2,
  ExternalLink,
  AlertTriangle,
  BookOpen,
  Clock,
  Save,
  Archive,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// ---- Types ----
interface DhppDocument {
  type: "RDS" | "SBD" | "SSR";
  title: string;
  url: string;
  product_type: string | null;
  control_number: string | null;
  din: string | null;
  manufacturer: string | null;
  submission_type: string | null;
  date_filed: string | null;
  decision_date: string | null;
  issued_date: string | null;
  updated_date: string | null;
  indication_summary: string | null;
  therapeutic_area: string | null;
  is_backdated: boolean;
}

interface GuidanceItem {
  title: string;
  url: string;
  date: string;
  source: string;
  therapeutic_area: string | null;
}

interface SafetyReviewPeriod {
  period: string;
  reviews: {
    brand_name: string;
    ingredient: string;
    safety_issue: string;
    trigger: string;
    therapeutic_area: string | null;
  }[];
  no_reviews_message: string | null;
}

interface MedEffectItem {
  title: string;
  url: string;
  date: string;
  therapeutic_area: string | null;
  is_infowatch: boolean;
  az_relevant_info: string | null;
}

interface Report {
  date_range: { from: string; to: string };
  transparency_documents: DhppDocument[];
  guidance_documents: GuidanceItem[];
  medeffect_whats_new: MedEffectItem[];
  safety_reviews: SafetyReviewPeriod[];
  safety_no_data_statement: string | null;
}

const TA_COLORS: Record<string, string> = {
  CMC: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  CVRM: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  CTA: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  ONC: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  RAOE: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  "RV&IT": "bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 14);
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] };
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function TaBadge({ ta }: { ta: string | null }) {
  if (!ta) return null;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${TA_COLORS[ta] || TA_COLORS.OTHER}`}>{ta}</span>;
}

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(getText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" onClick={handleCopy} className="gap-1.5">
      {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-green-600" /> : <Clipboard className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function ReviewerInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Input
      placeholder="Reviewer name"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 text-xs w-32"
    />
  );
}

// ---- Text formatters ----
function formatTransparencyText(docs: DhppDocument[]): string {
  if (docs.length === 0) return "No transparency documents found for this period.";
  return docs.map((doc) => {
    const lines = [`${doc.is_backdated ? "[BACKDATED] " : ""}${doc.title}`, doc.url];
    if (doc.therapeutic_area) lines.push(`Therapeutic Area: ${doc.therapeutic_area}`);
    if (doc.product_type) lines.push(`Product Type: ${doc.product_type}`);
    if (doc.control_number) lines.push(`Control Number: ${doc.control_number}`);
    if (doc.din) lines.push(`DIN(s): ${doc.din}`);
    if (doc.manufacturer) lines.push(`Manufacturer: ${doc.manufacturer}`);
    if (doc.submission_type) lines.push(`Submission Type: ${doc.submission_type}`);
    if (doc.date_filed) lines.push(`Date Filed: ${doc.date_filed}`);
    if (doc.decision_date) lines.push(`Authorization Date: ${doc.decision_date}`);
    if (doc.issued_date) lines.push(`Issued Date: ${doc.issued_date}`);
    if (doc.indication_summary && doc.indication_summary !== "Not available for this document type")
      lines.push(`Indication: ${doc.indication_summary}`);
    return lines.join("\n");
  }).join("\n\n");
}

function formatGuidanceText(items: GuidanceItem[]): string {
  if (items.length === 0) return "No guidance documents found for this period.";
  return items.map((i) => `${i.title} [${i.date}]${i.therapeutic_area ? ` (${i.therapeutic_area})` : ""}\n${i.url}\n(Source: ${i.source})`).join("\n\n");
}

function formatSafetyText(medeffect: MedEffectItem[], periods: SafetyReviewPeriod[], noDataStatement: string | null): string {
  const parts: string[] = [];
  if (medeffect.length > 0) {
    parts.push("MedEffect What's New:");
    parts.push(...medeffect.map((i) => {
      let line = `${i.title} [${i.date}]${i.therapeutic_area ? ` (${i.therapeutic_area})` : ""}\n${i.url}`;
      if (i.is_infowatch && i.az_relevant_info) line += `\nAZ Relevance: ${i.az_relevant_info}`;
      return line;
    }));
  }
  if (periods.length > 0) {
    parts.push("\nSafety and Effectiveness Reviews:");
    for (const p of periods) {
      if (p.no_reviews_message) {
        parts.push(p.no_reviews_message);
      } else if (p.reviews.length > 0) {
        parts.push(`\nReviews from ${p.period}:`);
        for (const r of p.reviews) {
          parts.push(`• ${r.brand_name} (${r.ingredient}) — ${r.safety_issue} [Trigger: ${r.trigger}]${r.therapeutic_area ? ` (${r.therapeutic_area})` : ""}`);
        }
      }
    }
  }
  if (noDataStatement) {
    parts.push(`\n${noDataStatement}`);
  }
  if (parts.length === 0) return "No safety reviews found for this period.";
  return parts.join("\n");
}

function formatFullReport(report: Report, reviewers: Record<string, string>): string {
  const header = `Health Canada What's New — ${formatDate(report.date_range.from)} to ${formatDate(report.date_range.to)}`;
  const sep = "=".repeat(60);

  // Add reviewer assignments
  const reviewerSection = Object.entries(reviewers).filter(([, v]) => v).map(([url, name]) => `${url}: ${name}`);
  const reviewerText = reviewerSection.length > 0 ? `\n\nReviewer Assignments:\n${reviewerSection.join("\n")}` : "";

  return [
    header, sep,
    "\na. Transparency Documents (RDS / SBD / SSR):\n",
    formatTransparencyText(report.transparency_documents),
    `\n${sep}`,
    "\nb. Guidance Documents, Notices, ICH, Consultations:\n",
    formatGuidanceText(report.guidance_documents),
    `\n${sep}`,
    "\nc. MedEffect Safety Reviews:\n",
    formatSafetyText(report.medeffect_whats_new, report.safety_reviews, report.safety_no_data_statement),
    reviewerText,
  ].join("\n");
}

export default function WhatsNew() {
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [reviewers, setReviewers] = useState<Record<string, string>>({});
  const [reportNotes, setReportNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const setReviewer = (url: string, name: string) => {
    setReviewers((prev) => ({ ...prev, [url]: name }));
  };

  async function handleGenerate() {
    if (!dateFrom || !dateTo) {
      toast({ title: "Please enter both dates", variant: "destructive" });
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      // Phase 1: DHPP (transparency documents)
      const { data: p1, error: e1 } = await supabase.functions.invoke("generate-whats-new", {
        body: { dateFrom, dateTo, phase: 1 },
      });
      if (e1) throw e1;
      if (p1?.error) throw new Error(p1.error);

      // Show partial results immediately
      const partialReport: Report = {
        date_range: { from: dateFrom, to: dateTo },
        transparency_documents: p1.transparency_documents || [],
        guidance_documents: [],
        medeffect_whats_new: [],
        safety_reviews: [],
        safety_no_data_statement: null,
      };
      setReport({ ...partialReport });

      // Phase 2: Guidance & Consultations
      const { data: p2, error: e2 } = await supabase.functions.invoke("generate-whats-new", {
        body: { dateFrom, dateTo, phase: 2 },
      });
      if (!e2 && !p2?.error) {
        partialReport.guidance_documents = p2.guidance_documents || [];
        setReport({ ...partialReport });
      }

      // Phase 3: MedEffect & Safety
      const { data: p3, error: e3 } = await supabase.functions.invoke("generate-whats-new", {
        body: { dateFrom, dateTo, phase: 3 },
      });
      if (!e3 && !p3?.error) {
        partialReport.medeffect_whats_new = p3.medeffect_whats_new || [];
        partialReport.safety_reviews = p3.safety_reviews || [];
        partialReport.safety_no_data_statement = p3.safety_no_data_statement || null;
        setReport({ ...partialReport });
      }

      toast({
        title: "Report generated",
        description: `${partialReport.transparency_documents.length} transparency docs, ${partialReport.guidance_documents.length} guidance items, ${partialReport.medeffect_whats_new.length} MedEffect items.`,
      });
    } catch (err) {
      console.error("Report error:", err);
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!report) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("saved_reports").insert({
        date_from: report.date_range.from,
        date_to: report.date_range.to,
        report_data: {
          transparency_documents: report.transparency_documents,
          guidance_documents: report.guidance_documents,
          medeffect_whats_new: report.medeffect_whats_new,
          safety_reviews: report.safety_reviews,
          safety_no_data_statement: report.safety_no_data_statement,
        },
        reviewers,
        notes: reportNotes || null,
      } as any);
      if (error) throw error;
      toast({ title: "Report saved!", description: "You can view it in the Saved Reports section." });
    } catch (err) {
      console.error("Save error:", err);
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const backdatedCount = report?.transparency_documents.filter((d) => d.is_backdated).length || 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">What's New Report Generator</h1>
          </div>
          <p className="text-muted-foreground text-sm ml-10">Generate SOP-compliant What's New intel screening reports</p>
          <div className="mt-3 ml-10 flex gap-4">
            <Link to="/" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">← Back to Monitor</Link>
            <Link to="/saved-reports" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium flex items-center gap-1"><Archive className="h-3.5 w-3.5" />Saved Reports</Link>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Date Range */}
        <Card className="p-5">
          <div className="flex flex-col sm:flex-row items-end gap-4">
            <div className="flex-1 w-full">
              <label className="text-sm font-medium text-foreground mb-1.5 block">From</label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="flex-1 w-full">
              <label className="text-sm font-medium text-foreground mb-1.5 block">To</label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <Button onClick={handleGenerate} disabled={loading} className="shrink-0 w-full sm:w-auto">
              {loading ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</>) : (<><FileText className="h-4 w-4 mr-2" />Generate Report</>)}
            </Button>
          </div>
          {loading && <p className="text-sm text-muted-foreground mt-3 animate-pulse">{report ? "Fetching additional sections..." : "Scraping Health Canada websites (Phase 1 of 3)..."}</p>}
        </Card>

        {/* Report */}
        {report && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Report: {formatDate(report.date_range.from)} — {formatDate(report.date_range.to)}</h2>
              <CopyButton getText={() => formatFullReport(report, reviewers)} />
            </div>

            {/* TA Legend */}
            <div className="flex flex-wrap gap-2 text-xs">
              {Object.keys(TA_COLORS).map((ta) => (<TaBadge key={ta} ta={ta} />))}
            </div>

            {/* Section A: Transparency Documents */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-muted/50 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">a. Transparency Documents (RDS / SBD / SSR)</h3>
                  <Badge variant="secondary" className="text-xs">{report.transparency_documents.length}</Badge>
                  {backdatedCount > 0 && (
                    <Badge variant="destructive" className="text-xs gap-1"><Clock className="h-3 w-3" />{backdatedCount} backdated</Badge>
                  )}
                </div>
                <CopyButton getText={() => formatTransparencyText(report.transparency_documents)} />
              </div>
              <div className="p-4 space-y-4">
                {report.transparency_documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transparency documents found.</p>
                ) : (
                  report.transparency_documents.map((doc, i) => (
                    <div key={i} className={`border-b border-border/30 pb-4 last:border-0 last:pb-0 ${doc.is_backdated ? "bg-amber-50 dark:bg-amber-950/20 -mx-4 px-4 py-3 rounded" : ""}`}>
                      <div className="flex items-start gap-2 mb-2">
                        <Badge variant={doc.type === "SSR" ? "destructive" : "secondary"} className="text-xs shrink-0 mt-0.5">{doc.type}</Badge>
                        <TaBadge ta={doc.therapeutic_area} />
                        {doc.is_backdated && <Badge variant="outline" className="text-xs shrink-0 mt-0.5 border-amber-500 text-amber-700 dark:text-amber-400 gap-1"><Clock className="h-3 w-3" />Backdated</Badge>}
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-foreground hover:text-primary transition-colors flex-1">
                          {doc.title}<ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                        </a>
                        <ReviewerInput value={reviewers[doc.url] || ""} onChange={(v) => setReviewer(doc.url, v)} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-muted-foreground ml-12">
                        {doc.product_type && <div><span className="font-medium">Product Type:</span> {doc.product_type}</div>}
                        {doc.control_number && <div><span className="font-medium">Control #:</span> {doc.control_number}</div>}
                        {doc.din && <div><span className="font-medium">DIN(s):</span> {doc.din}</div>}
                        {doc.manufacturer && <div><span className="font-medium">Manufacturer:</span> {doc.manufacturer}</div>}
                        {doc.submission_type && <div><span className="font-medium">Submission Type:</span> {doc.submission_type}</div>}
                        {doc.date_filed && <div><span className="font-medium">Date Filed:</span> {doc.date_filed}</div>}
                        {doc.decision_date && <div><span className="font-medium">Authorization Date:</span> {doc.decision_date}</div>}
                        {doc.issued_date && <div><span className="font-medium">Issued Date:</span> {doc.issued_date}</div>}
                      </div>
                      {doc.indication_summary && doc.indication_summary !== "Not available for this document type" && (
                        <div className="mt-2 ml-12 text-xs bg-muted/50 rounded p-2">
                          <span className="font-medium text-foreground">Indication:</span>{" "}
                          <span className="text-muted-foreground">{doc.indication_summary}</span>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Section B: Guidance Documents */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-muted/50 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">b. Guidance, Notices, ICH, Consultations</h3>
                  <Badge variant="secondary" className="text-xs">{report.guidance_documents.length}</Badge>
                </div>
                <CopyButton getText={() => formatGuidanceText(report.guidance_documents)} />
              </div>
              <div className="p-4 space-y-3">
                {report.guidance_documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No guidance documents found.</p>
                ) : (
                  report.guidance_documents.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <Badge variant="outline" className="text-xs shrink-0 mt-0.5">{item.source}</Badge>
                      <TaBadge ta={item.therapeutic_area} />
                      <div className="flex-1">
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors">
                          {item.title}<ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                        </a>
                        <span className="text-xs text-muted-foreground ml-2">[{item.date}]</span>
                      </div>
                      <ReviewerInput value={reviewers[item.url] || ""} onChange={(v) => setReviewer(item.url, v)} />
                    </div>
                  ))
                )}
              </div>
            </Card>

            {/* Section C: Safety Reviews */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-muted/50 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">c. MedEffect Safety Reviews</h3>
                  <Badge variant="secondary" className="text-xs">
                    {report.medeffect_whats_new.length + report.safety_reviews.reduce((a, p) => a + p.reviews.length, 0)}
                  </Badge>
                </div>
                <CopyButton getText={() => formatSafetyText(report.medeffect_whats_new, report.safety_reviews, report.safety_no_data_statement)} />
              </div>
              <div className="p-4 space-y-4">
                {report.medeffect_whats_new.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2">MedEffect What's New</h4>
                    {report.medeffect_whats_new.map((item, i) => (
                      <div key={i} className="text-sm mb-3 flex items-start gap-2">
                        <TaBadge ta={item.therapeutic_area} />
                        {item.is_infowatch && <Badge variant="outline" className="text-xs shrink-0 mt-0.5 border-primary/50 text-primary">InfoWatch</Badge>}
                        <div className="flex-1">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary transition-colors">
                            {item.title}<ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                          </a>
                          <span className="text-xs text-muted-foreground ml-2">[{item.date}]</span>
                          {item.is_infowatch && item.az_relevant_info && (
                            <p className="text-xs text-muted-foreground mt-1 bg-muted/50 rounded p-2">
                              <span className="font-medium text-foreground">AZ Relevance:</span> {item.az_relevant_info}
                            </p>
                          )}
                        </div>
                        <ReviewerInput value={reviewers[item.url] || ""} onChange={(v) => setReviewer(item.url, v)} />
                      </div>
                    ))}
                  </div>
                )}

                {report.safety_reviews.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2">Safety and Effectiveness Reviews</h4>
                    {report.safety_reviews.map((period, i) => (
                      <div key={i} className="mb-4">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Reviews from {period.period}:</p>
                        {period.no_reviews_message ? (
                          <p className="text-xs text-muted-foreground italic">{period.no_reviews_message}</p>
                        ) : period.reviews.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-border/60 rounded">
                              <thead><tr className="bg-muted/50">
                                <th className="text-left p-2 font-medium">TA</th>
                                <th className="text-left p-2 font-medium">Brand Name</th>
                                <th className="text-left p-2 font-medium">Ingredient(s)</th>
                                <th className="text-left p-2 font-medium">Safety Issue</th>
                                <th className="text-left p-2 font-medium">Trigger</th>
                                <th className="text-left p-2 font-medium">Reviewer</th>
                              </tr></thead>
                              <tbody>
                                {period.reviews.map((r, j) => (
                                  <tr key={j} className="border-t border-border/30">
                                    <td className="p-2"><TaBadge ta={r.therapeutic_area} /></td>
                                    <td className="p-2">{r.brand_name}</td>
                                    <td className="p-2">{r.ingredient}</td>
                                    <td className="p-2">{r.safety_issue}</td>
                                    <td className="p-2">{r.trigger}</td>
                                    <td className="p-2"><ReviewerInput value={reviewers[`safety-${i}-${j}`] || ""} onChange={(v) => setReviewer(`safety-${i}-${j}`, v)} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">No reviews for this period.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {report.safety_no_data_statement && (
                  <div className="bg-muted/50 rounded p-3">
                    <p className="text-sm text-muted-foreground italic">{report.safety_no_data_statement}</p>
                  </div>
                )}

                {report.medeffect_whats_new.length === 0 && report.safety_reviews.length === 0 && !report.safety_no_data_statement && (
                  <p className="text-sm text-muted-foreground">No safety reviews found.</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
