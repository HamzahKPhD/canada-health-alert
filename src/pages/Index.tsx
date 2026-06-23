import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ReviewDocumentCard } from "@/components/ReviewDocumentCard";
import { ScanStatus } from "@/components/ScanStatus";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, ShieldCheck, FileText, Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { downloadManyAsPdf } from "@/lib/pdf-download";

interface ReviewDocument {
  id: string;
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
  first_seen_at: string;
}

interface ScanLog {
  id: string;
  scanned_at: string;
  new_documents_count: number;
  total_documents_count: number;
  status: string;
}

const PAGE_SIZE = 1000;

export default function Index() {
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [lastScan, setLastScan] = useState<ScanLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ done: number; total: number; title: string } | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();
    fetchLastScan();
  }, []);

  async function fetchDocuments() {
    setLoading(true);
    // Page through all rows — there can be thousands
    const all: ReviewDocument[] = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("review_documents")
        .select("*")
        .order("first_seen_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error("Error fetching documents:", error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...(data as ReviewDocument[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    setDocuments(all);
    setLoading(false);
  }

  async function fetchLastScan() {
    const { data } = await supabase
      .from("scan_log")
      .select("*")
      .order("scanned_at", { ascending: false })
      .limit(1)
      .single();
    if (data) setLastScan(data as ScanLog);
  }

  async function handleScan() {
    setIsScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke("scrape-health-canada");
      if (error) throw error;
      toast({
        title: "Scan complete",
        description: `Found ${data.scraped} documents. ${data.new_documents} new.`,
      });
      await fetchDocuments();
      await fetchLastScan();
    } catch (err) {
      console.error("Scan error:", err);
      toast({
        title: "Scan failed",
        description: "Could not complete the scan. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsScanning(false);
    }
  }

  const filtered = useMemo(() => {
    if (!searchQuery) return documents;
    const q = searchQuery.toLowerCase();
    return documents.filter((doc) =>
      doc.title.toLowerCase().includes(q) ||
      doc.manufacturer?.toLowerCase().includes(q) ||
      doc.din?.toLowerCase().includes(q) ||
      doc.control_number?.toLowerCase().includes(q) ||
      doc.product_type?.toLowerCase().includes(q) ||
      doc.submission_type?.toLowerCase().includes(q) ||
      doc.indication_summary?.toLowerCase().includes(q)
    );
  }, [documents, searchQuery]);

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((d) => selected.has(d.id));
  function toggleAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) filtered.forEach((d) => next.add(d.id));
      else filtered.forEach((d) => next.delete(d.id));
      return next;
    });
  }

  async function handleDownload() {
    const items = documents
      .filter((d) => selected.has(d.id))
      .map((d) => ({ url: d.url, title: d.title }));
    if (items.length === 0) return;
    setDownloading(true);
    setDownloadProgress({ done: 0, total: items.length, title: items[0].title });
    try {
      const result = await downloadManyAsPdf(items, (done, total, title) =>
        setDownloadProgress({ done, total, title })
      );
      toast({
        title: "Download complete",
        description: `${result.success} saved${result.failed.length ? `, ${result.failed.length} failed` : ""}.`,
        variant: result.failed.length ? "destructive" : "default",
      });
      if (result.failed.length) {
        console.error("Failed PDFs:", result.failed);
      }
    } catch (err) {
      console.error(err);
      toast({ title: "Download failed", description: String(err), variant: "destructive" });
    } finally {
      setDownloading(false);
      setDownloadProgress(null);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60 bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Health Canada Monitor</h1>
          </div>
          <p className="text-muted-foreground text-sm ml-10">
            Tracking review decisions from the Drug and Health Product Portal
          </p>
          <div className="mt-3 ml-10">
            <Link to="/whats-new">
              <Button variant="outline" size="sm" className="gap-2">
                <FileText className="h-4 w-4" />
                Generate What's New Report
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-5">
        <ScanStatus lastScan={lastScan} isScanning={isScanning} onScan={handleScan} />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, manufacturer, DIN, control #, indication..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {!loading && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  checked={allVisibleSelected}
                  onCheckedChange={(c) => toggleAllVisible(!!c)}
                />
                Select all visible
              </label>
              <span className="text-sm text-muted-foreground">
                Showing {filtered.length} of {documents.length} · {selected.size} selected
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                onClick={handleDownload}
                disabled={selected.size === 0 || downloading}
                className="gap-2"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download {selected.size > 0 ? `(${selected.size})` : ""} as PDF
              </Button>
            </div>
          </div>
        )}

        {downloadProgress && (
          <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
            Generating PDF {downloadProgress.done + 1} of {downloadProgress.total}:{" "}
            <span className="text-muted-foreground">{downloadProgress.title}</span>
          </div>
        )}

        <div className="space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-lg" />
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              {documents.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-lg font-medium">No documents yet</p>
                  <p className="text-sm">
                    Click "Scan Now" to fetch every SBD/RDS from Health Canada.
                  </p>
                </div>
              ) : (
                <p>No documents match your search.</p>
              )}
            </div>
          ) : (
            filtered.map((doc) => (
              <div key={doc.id} className="flex items-start gap-3">
                <Checkbox
                  className="mt-5"
                  checked={selected.has(doc.id)}
                  onCheckedChange={(c) => toggleOne(doc.id, !!c)}
                  aria-label={`Select ${doc.title}`}
                />
                <div className="flex-1 min-w-0">
                  <ReviewDocumentCard doc={doc} latestScanAt={lastScan?.scanned_at ?? null} />
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}
