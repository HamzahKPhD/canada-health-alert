import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ReviewDocumentCard } from "@/components/ReviewDocumentCard";
import { ScanStatus } from "@/components/ScanStatus";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
  first_seen_at: string;
}

interface ScanLog {
  id: string;
  scanned_at: string;
  new_documents_count: number;
  total_documents_count: number;
  status: string;
}

export default function Index() {
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [lastScan, setLastScan] = useState<ScanLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();
    fetchLastScan();
  }, []);

  async function fetchDocuments() {
    setLoading(true);
    const { data, error } = await supabase
      .from("review_documents")
      .select("*")
      .order("first_seen_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Error fetching documents:", error);
    } else {
      setDocuments((data as ReviewDocument[]) || []);
    }
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
      const { data, error } = await supabase.functions.invoke(
        "scrape-health-canada"
      );

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

  const filtered = documents.filter((doc) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      doc.title.toLowerCase().includes(q) ||
      doc.manufacturer?.toLowerCase().includes(q) ||
      doc.din?.toLowerCase().includes(q) ||
      doc.control_number?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/60 bg-card">
        <div className="container max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-1">
            <ShieldCheck className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">
              Health Canada Monitor
            </h1>
          </div>
          <p className="text-muted-foreground text-sm ml-10">
            Tracking review decisions from the Drug and Health Product Portal
          </p>
        </div>
      </header>

      <main className="container max-w-5xl mx-auto px-4 py-6 space-y-5">
        {/* Scan Status */}
        <ScanStatus
          lastScan={lastScan}
          isScanning={isScanning}
          onScan={handleScan}
        />

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, manufacturer, DIN, or control number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Results count */}
        {!loading && (
          <p className="text-sm text-muted-foreground">
            Showing {filtered.length} of {documents.length} documents
          </p>
        )}

        {/* Documents list */}
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
                    Click "Scan Now" to fetch the latest review decisions from
                    Health Canada.
                  </p>
                </div>
              ) : (
                <p>No documents match your search.</p>
              )}
            </div>
          ) : (
            filtered.map((doc) => (
              <ReviewDocumentCard key={doc.id} doc={doc} />
            ))
          )}
        </div>
      </main>
    </div>
  );
}
