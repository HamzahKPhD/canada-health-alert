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
} from "lucide-react";

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
}

interface GuidanceItem {
  title: string;
  url: string;
  date: string;
  source: string;
}

interface SafetyReviewPeriod {
  period: string;
  reviews: {
    brand_name: string;
    ingredient: string;
    safety_issue: string;
    trigger: string;
  }[];
  no_reviews_message: string | null;
}

interface MedEffectItem {
  title: string;
  url: string;
  date: string;
}

interface Report {
  date_range: { from: string; to: string };
  transparency_documents: DhppDocument[];
  guidance_documents: GuidanceItem[];
  medeffect_whats_new: MedEffectItem[];
  safety_reviews: SafetyReviewPeriod[];
}

function getDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 14);
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  };
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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
      {copied ? (
        <ClipboardCheck className="h-3.5 w-3.5 text-[hsl(var(--new-badge))]" />
      ) : (
        <Clipboard className="h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function formatTransparencyText(docs: DhppDocument[]): string {
  if (docs.length === 0) return "No transparency documents found for this period.";
  return docs
    .map((doc) => {
      const lines = [doc.title, doc.url];
      if (doc.product_type) lines.push(`Product Type: ${doc.product_type}`);
      if (doc.control_number) lines.push(`Control Number: ${doc.control_number}`);
      if (doc.din) lines.push(`DIN(s): ${doc.din}`);
      if (doc.manufacturer) lines.push(`Manufacturer: ${doc.manufacturer}`);
      if (doc.submission_type) lines.push(`Submission Type: ${doc.submission_type}`);
      if (doc.date_filed) lines.push(`Date Filed / Submission Date: ${doc.date_filed}`);
      if (doc.decision_date) lines.push(`Decision / Authorization Date: ${doc.decision_date}`);
      if (doc.issued_date) lines.push(`Issued / Original Publication Date: ${doc.issued_date}`);
      if (doc.indication_summary && doc.indication_summary !== "Not available for this document type") {
        lines.push(`Indication: ${doc.indication_summary}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function formatGuidanceText(items: GuidanceItem[]): string {
  if (items.length === 0) return "No guidance documents found for this period.";
  return items.map((item) => `${item.title} [${item.date}]\n${item.url}\n(Source: ${item.source})`).join("\n\n");
}

function formatSafetyText(medeffect: MedEffectItem[], periods: SafetyReviewPeriod[]): string {
  const parts: string[] = [];
  if (medeffect.length > 0) {
    parts.push("MedEffect What's New:");
    parts.push(...medeffect.map((i) => `${i.title} [${i.date}]\n${i.url}`));
  }
  if (periods.length > 0) {
    parts.push("\nSafety and Effectiveness Reviews:");
    for (const p of periods) {
      if (p.no_reviews_message) {
        parts.push(p.no_reviews_message);
      } else if (p.reviews.length > 0) {
        parts.push(`\nList of Safety and Effectiveness Reviews Initiated from ${p.period}:`);
        for (const r of p.reviews) {
          parts.push(`• ${r.brand_name} (${r.ingredient}) — ${r.safety_issue} [Trigger: ${r.trigger}]`);
        }
      }
    }
  }
  if (parts.length === 0) return "No safety reviews found for this period.";
  return parts.join("\n");
}

function formatFullReport(report: Report): string {
  const header = `Health Canada What's New — ${formatDate(report.date_range.from)} to ${formatDate(report.date_range.to)}`;
  const sep = "=".repeat(60);
  return [
    header,
    sep,
    "\na. List of transparency documents posted for assessment of any TA-related follow up actions:\n",
    formatTransparencyText(report.transparency_documents),
    `\n${sep}`,
    "\nb. List of draft/final guidance documents, notices, ICH documents, consultation documents, new forms where follow up action may be required:\n",
    formatGuidanceText(report.guidance_documents),
    `\n${sep}`,
    "\nc. Health Canada-conducted safety reviews posted on MedEffect:\n",
    formatSafetyText(report.medeffect_whats_new, report.safety_reviews),
  ].join("\n");
}

export default function WhatsNew() {
  const defaults = getDefaultDates();
  const [dateFrom, setDateFrom] = useState(defaults.from);
  const [dateTo, setDateTo] = useState(defaults.to);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleGenerate() {
    if (!dateFrom || !dateTo) {
      toast({ title: "Please enter both dates", variant: "destructive" });
      return;
    }
    setLoading(true);
    setReport(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-whats-new", {
        body: { dateFrom, dateTo },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      setReport(data as Report);
      toast({
        title: "Report generated",
        description: `Found ${data.transparency_documents.length} transparency docs, ${data.guidance_documents.length} guidance items, ${data.medeffect_whats_new.length} MedEffect items.`,
      });
    } catch (err) {
      console.error("Report error:", err);
      toast({
        title: "Generation failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">What's New Report Generator</h1>
          </div>
          <p className="text-muted-foreground text-sm ml-10">
            Generate SOP-compliant What's New intel screening reports
          </p>
          <div className="mt-3 ml-10">
            <Link to="/" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">← Back to Monitor</Link>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Date Range Input */}
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
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4 mr-2" />
                  Generate Report
                </>
              )}
            </Button>
          </div>
          {loading && (
            <p className="text-sm text-muted-foreground mt-3 animate-pulse">
              Scraping Health Canada websites... this may take 30-60 seconds.
            </p>
          )}
        </Card>

        {/* Report Output */}
        {report && (
          <div className="space-y-6">
            {/* Full Report Copy */}
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                Report: {formatDate(report.date_range.from)} — {formatDate(report.date_range.to)}
              </h2>
              <CopyButton getText={() => formatFullReport(report)} />
            </div>

            {/* Section A: Transparency Documents */}
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between p-4 bg-muted/50 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">
                    a. Transparency Documents (RDS / SBD / SSR)
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {report.transparency_documents.length}
                  </Badge>
                </div>
                <CopyButton getText={() => formatTransparencyText(report.transparency_documents)} />
              </div>
              <div className="p-4 space-y-4">
                {report.transparency_documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No transparency documents found for this period.</p>
                ) : (
                  report.transparency_documents.map((doc, i) => (
                    <div key={i} className="border-b border-border/30 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-start gap-2 mb-2">
                        <Badge
                          variant={doc.type === "SSR" ? "destructive" : "secondary"}
                          className="text-xs shrink-0 mt-0.5"
                        >
                          {doc.type}
                        </Badge>
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-foreground hover:text-primary transition-colors"
                        >
                          {doc.title}
                          <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                        </a>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs text-muted-foreground ml-12">
                        {doc.product_type && <div><span className="font-medium">Product Type:</span> {doc.product_type}</div>}
                        {doc.control_number && <div><span className="font-medium">Control Number:</span> {doc.control_number}</div>}
                        {doc.din && <div><span className="font-medium">DIN(s):</span> {doc.din}</div>}
                        {doc.manufacturer && <div><span className="font-medium">Manufacturer:</span> {doc.manufacturer}</div>}
                        {doc.submission_type && <div><span className="font-medium">Submission Type:</span> {doc.submission_type}</div>}
                        {doc.date_filed && <div><span className="font-medium">Date Filed:</span> {doc.date_filed}</div>}
                        {doc.decision_date && <div><span className="font-medium">Decision / Authorization Date:</span> {doc.decision_date}</div>}
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
                  <h3 className="font-semibold text-sm">
                    b. Guidance Documents, Notices, ICH, Consultations
                  </h3>
                  <Badge variant="secondary" className="text-xs">
                    {report.guidance_documents.length}
                  </Badge>
                </div>
                <CopyButton getText={() => formatGuidanceText(report.guidance_documents)} />
              </div>
              <div className="p-4 space-y-3">
                {report.guidance_documents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No guidance documents found for this period.</p>
                ) : (
                  report.guidance_documents.map((item, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
                        {item.source}
                      </Badge>
                      <div>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {item.title}
                          <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                        </a>
                        <span className="text-xs text-muted-foreground ml-2">[{item.date}]</span>
                      </div>
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
                <CopyButton getText={() => formatSafetyText(report.medeffect_whats_new, report.safety_reviews)} />
              </div>
              <div className="p-4 space-y-4">
                {/* MedEffect What's New items */}
                {report.medeffect_whats_new.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2">MedEffect What's New</h4>
                    {report.medeffect_whats_new.map((item, i) => (
                      <div key={i} className="text-sm mb-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground hover:text-primary transition-colors"
                        >
                          {item.title}
                          <ExternalLink className="inline h-3 w-3 ml-1 opacity-50" />
                        </a>
                        <span className="text-xs text-muted-foreground ml-2">[{item.date}]</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Safety Review Periods */}
                {report.safety_reviews.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-foreground mb-2">
                      Safety and Effectiveness Reviews
                    </h4>
                    {report.safety_reviews.map((period, i) => (
                      <div key={i} className="mb-4">
                        <p className="text-xs font-medium text-muted-foreground mb-1">
                          Reviews initiated from {period.period}:
                        </p>
                        {period.no_reviews_message ? (
                          <p className="text-xs text-muted-foreground italic">{period.no_reviews_message}</p>
                        ) : period.reviews.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-border/60 rounded">
                              <thead>
                                <tr className="bg-muted/50">
                                  <th className="text-left p-2 font-medium">Brand Name</th>
                                  <th className="text-left p-2 font-medium">Ingredient(s)</th>
                                  <th className="text-left p-2 font-medium">Safety Issue</th>
                                  <th className="text-left p-2 font-medium">Trigger</th>
                                </tr>
                              </thead>
                              <tbody>
                                {period.reviews.map((r, j) => (
                                  <tr key={j} className="border-t border-border/30">
                                    <td className="p-2">{r.brand_name}</td>
                                    <td className="p-2">{r.ingredient}</td>
                                    <td className="p-2">{r.safety_issue}</td>
                                    <td className="p-2">{r.trigger}</td>
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

                {report.medeffect_whats_new.length === 0 && report.safety_reviews.length === 0 && (
                  <p className="text-sm text-muted-foreground">No safety reviews found for this period.</p>
                )}
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
