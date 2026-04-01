import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Trash2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Clock,
  Archive,
  FileText,
  AlertTriangle,
  BookOpen,
  Clipboard,
  ClipboardCheck,
} from "lucide-react";

interface SavedReport {
  id: string;
  created_at: string;
  date_from: string;
  date_to: string;
  report_data: any;
  reviewers: Record<string, string>;
  notes: string | null;
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

function TaBadge({ ta }: { ta: string | null }) {
  if (!ta) return null;
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${TA_COLORS[ta] || TA_COLORS.OTHER}`}>{ta}</span>;
}

function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
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
      {copied ? "Copied" : "Copy All"}
    </Button>
  );
}

function formatFullSavedReport(r: SavedReport): string {
  const data = r.report_data;
  const reviewers = r.reviewers || {};
  const lines: string[] = [];
  lines.push(`Health Canada What's New — ${formatDate(r.date_from)} to ${formatDate(r.date_to)}`);
  lines.push("=".repeat(60));
  lines.push(`Saved: ${new Date(r.created_at).toLocaleString("en-CA")}`);
  if (r.notes) lines.push(`Notes: ${r.notes}`);

  // Transparency
  lines.push("\na. Transparency Documents (RDS / SBD / SSR):\n");
  const docs = data.transparency_documents || [];
  if (docs.length === 0) {
    lines.push("No transparency documents found for this period.");
  } else {
    for (const doc of docs) {
      const docLines = [`${doc.is_backdated ? "[BACKDATED] " : ""}${doc.title}`, doc.url];
      if (doc.therapeutic_area) docLines.push(`Therapeutic Area: ${doc.therapeutic_area}`);
      if (doc.manufacturer) docLines.push(`Manufacturer: ${doc.manufacturer}`);
      if (doc.decision_date) docLines.push(`Authorization Date: ${doc.decision_date}`);
      if (doc.indication_summary && doc.indication_summary !== "Not available for this document type")
        docLines.push(`Indication: ${doc.indication_summary}`);
      if (reviewers[doc.url]) docLines.push(`Reviewer: ${reviewers[doc.url]}`);
      lines.push(docLines.join("\n"));
      lines.push("");
    }
  }

  // Guidance
  lines.push("\nb. Guidance, Notices, ICH, Consultations:\n");
  const guidance = data.guidance_documents || [];
  if (guidance.length === 0) {
    lines.push("No guidance documents found for this period.");
  } else {
    for (const item of guidance) {
      lines.push(`${item.title} [${item.date}] (${item.source})${reviewers[item.url] ? ` — Reviewer: ${reviewers[item.url]}` : ""}`);
      lines.push(item.url);
      lines.push("");
    }
  }

  // MedEffect
  lines.push("\nc. MedEffect Safety Reviews:\n");
  const medeffect = data.medeffect_whats_new || [];
  if (medeffect.length > 0) {
    for (const item of medeffect) {
      lines.push(`${item.title} [${item.date}]`);
      lines.push(item.url);
      if (item.az_relevant_info) lines.push(`AZ Relevance: ${item.az_relevant_info}`);
      lines.push("");
    }
  }
  const periods = data.safety_reviews || [];
  for (const p of periods) {
    if (p.no_reviews_message) {
      lines.push(p.no_reviews_message);
    } else if (p.reviews?.length > 0) {
      lines.push(`Reviews from ${p.period}:`);
      for (const rev of p.reviews) {
        lines.push(`• ${rev.brand_name} (${rev.ingredient}) — ${rev.safety_issue} [${rev.trigger}]`);
      }
    }
  }
  if (data.safety_no_data_statement) lines.push(data.safety_no_data_statement);

  // Reviewer summary
  const assignedReviewers = Object.entries(reviewers).filter(([, v]) => v);
  if (assignedReviewers.length > 0) {
    lines.push("\n\nReviewer Assignments:");
    for (const [key, name] of assignedReviewers) {
      lines.push(`${key}: ${name}`);
    }
  }

  return lines.join("\n");
}

export default function SavedReports() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { toast } = useToast();

  const fetchReports = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("saved_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast({ title: "Error loading reports", description: error.message, variant: "destructive" });
    } else {
      setReports((data as SavedReport[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchReports(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this saved report?")) return;
    setDeleting(id);
    const { error } = await supabase.from("saved_reports").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      setReports((prev) => prev.filter((r) => r.id !== id));
      toast({ title: "Report deleted" });
    }
    setDeleting(null);
  };

  const toggle = (id: string) => setExpandedId(expandedId === id ? null : id);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <Archive className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Saved Reports</h1>
          </div>
          <p className="text-muted-foreground text-sm ml-10">Audit trail of all generated What's New reports with reviewer assignments</p>
          <div className="mt-3 ml-10 flex gap-4">
            <Link to="/" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">← Back to Monitor</Link>
            <Link to="/whats-new" className="text-sm text-primary hover:text-primary/80 transition-colors font-medium">← Generate Report</Link>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-4">
        {loading ? (
          <p className="text-sm text-muted-foreground animate-pulse">Loading saved reports...</p>
        ) : reports.length === 0 ? (
          <Card className="p-8 text-center">
            <Archive className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No saved reports yet. Generate a report and save it from the <Link to="/whats-new" className="text-primary hover:underline">What's New</Link> page.</p>
          </Card>
        ) : (
          reports.map((r) => {
            const data = r.report_data;
            const docCount = (data.transparency_documents || []).length;
            const guidanceCount = (data.guidance_documents || []).length;
            const medCount = (data.medeffect_whats_new || []).length;
            const reviewerCount = Object.values(r.reviewers || {}).filter(Boolean).length;
            const isExpanded = expandedId === r.id;

            return (
              <Card key={r.id} className="overflow-hidden">
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggle(r.id)}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isExpanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">
                        {formatDate(r.date_from)} — {formatDate(r.date_to)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Saved {new Date(r.created_at).toLocaleString("en-CA")}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-3 flex-wrap">
                      <Badge variant="secondary" className="text-xs gap-1"><BookOpen className="h-3 w-3" />{docCount} docs</Badge>
                      <Badge variant="secondary" className="text-xs gap-1"><FileText className="h-3 w-3" />{guidanceCount} guidance</Badge>
                      <Badge variant="secondary" className="text-xs gap-1"><AlertTriangle className="h-3 w-3" />{medCount} safety</Badge>
                      {reviewerCount > 0 && <Badge variant="outline" className="text-xs">{reviewerCount} reviewers</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
                    <CopyButton getText={() => formatFullSavedReport(r)} />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(r.id)}
                      disabled={deleting === r.id}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/60 p-4 space-y-4">
                    {r.notes && (
                      <div className="bg-muted/50 rounded p-3 text-sm">
                        <span className="font-medium">Notes:</span> {r.notes}
                      </div>
                    )}

                    {/* Transparency */}
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <BookOpen className="h-3.5 w-3.5 text-primary" /> a. Transparency Documents
                      </h4>
                      {(data.transparency_documents || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">None</p>
                      ) : (
                        (data.transparency_documents || []).map((doc: any, i: number) => (
                          <div key={i} className={`text-xs mb-2 pb-2 border-b border-border/20 last:border-0 ${doc.is_backdated ? "bg-amber-50 dark:bg-amber-950/20 rounded p-2" : ""}`}>
                            <div className="flex items-start gap-1.5">
                              <Badge variant="secondary" className="text-[10px] shrink-0">{doc.type}</Badge>
                              <TaBadge ta={doc.therapeutic_area} />
                              {doc.is_backdated && <Badge variant="outline" className="text-[10px] border-amber-500 text-amber-700 dark:text-amber-400"><Clock className="h-2.5 w-2.5 mr-0.5" />Backdated</Badge>}
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary flex-1">
                                {doc.title}<ExternalLink className="inline h-2.5 w-2.5 ml-1 opacity-50" />
                              </a>
                              {(r.reviewers || {})[doc.url] && (
                                <span className="text-muted-foreground shrink-0">👤 {(r.reviewers || {})[doc.url]}</span>
                              )}
                            </div>
                            {doc.indication_summary && doc.indication_summary !== "Not available for this document type" && (
                              <p className="mt-1 ml-4 text-muted-foreground">Indication: {doc.indication_summary}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* Guidance */}
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-primary" /> b. Guidance, Notices, ICH, Consultations
                      </h4>
                      {(data.guidance_documents || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">None</p>
                      ) : (
                        (data.guidance_documents || []).map((item: any, i: number) => (
                          <div key={i} className="text-xs mb-1.5 flex items-start gap-1.5">
                            <Badge variant="outline" className="text-[10px] shrink-0">{item.source}</Badge>
                            <TaBadge ta={item.therapeutic_area} />
                            <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary flex-1">
                              {item.title}<ExternalLink className="inline h-2.5 w-2.5 ml-1 opacity-50" />
                            </a>
                            <span className="text-muted-foreground">[{item.date}]</span>
                            {(r.reviewers || {})[item.url] && (
                              <span className="text-muted-foreground shrink-0">👤 {(r.reviewers || {})[item.url]}</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>

                    {/* MedEffect */}
                    <div>
                      <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-primary" /> c. MedEffect Safety Reviews
                      </h4>
                      {(data.medeffect_whats_new || []).map((item: any, i: number) => (
                        <div key={i} className="text-xs mb-1.5">
                          <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-foreground hover:text-primary">
                            {item.title}<ExternalLink className="inline h-2.5 w-2.5 ml-1 opacity-50" />
                          </a>
                          <span className="text-muted-foreground ml-1">[{item.date}]</span>
                        </div>
                      ))}
                      {(data.safety_reviews || []).map((p: any, i: number) => (
                        <div key={i} className="text-xs mb-2">
                          {p.no_reviews_message ? (
                            <p className="text-muted-foreground italic">{p.no_reviews_message}</p>
                          ) : p.reviews?.length > 0 ? (
                            <>
                              <p className="font-medium text-muted-foreground mb-1">Reviews from {p.period}:</p>
                              {p.reviews.map((rev: any, j: number) => (
                                <p key={j} className="ml-2">• {rev.brand_name} ({rev.ingredient}) — {rev.safety_issue}</p>
                              ))}
                            </>
                          ) : null}
                        </div>
                      ))}
                      {data.safety_no_data_statement && (
                        <p className="text-xs text-muted-foreground italic">{data.safety_no_data_statement}</p>
                      )}
                      {(data.medeffect_whats_new || []).length === 0 && (data.safety_reviews || []).length === 0 && !data.safety_no_data_statement && (
                        <p className="text-xs text-muted-foreground">None</p>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
