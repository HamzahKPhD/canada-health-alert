import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ExternalLink, Calendar, Building2, FileText, Pill } from "lucide-react";

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

function isNew(firstSeenAt: string, latestScanAt: string | null): boolean {
  if (!latestScanAt) return false;
  // Document is "new" if it was first seen during or after the latest scan
  const seenDate = new Date(firstSeenAt);
  const scanDate = new Date(latestScanAt);
  // Allow 5 minutes buffer before scan time
  return seenDate.getTime() >= scanDate.getTime() - 5 * 60 * 1000;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ReviewDocumentCard({ doc, latestScanAt }: { doc: ReviewDocument; latestScanAt: string | null }) {
  const isNewDoc = isNew(doc.first_seen_at, latestScanAt);
  const authDate = doc.decision_date || doc.issued_date;

  return (
    <Card className="group relative overflow-hidden border-border/60 transition-all duration-200 hover:border-primary/30 hover:shadow-md">
      {isNewDoc && (
        <div className="absolute top-0 right-0 z-10">
          <Badge className="rounded-none rounded-bl-md bg-[hsl(var(--new-badge))] text-[hsl(var(--new-badge-foreground))] font-semibold text-xs px-3 py-1 shadow-sm">
            NEW
          </Badge>
        </div>
      )}

      <div className="p-5 space-y-3">
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block group/link"
        >
          <h3 className="font-semibold text-foreground leading-snug pr-14 group-hover/link:text-primary transition-colors">
            {doc.title}
            <ExternalLink className="inline-block ml-1.5 h-3.5 w-3.5 opacity-0 group-hover/link:opacity-70 transition-opacity" />
          </h3>
        </a>

        <div className="flex flex-wrap gap-2">
          {doc.product_type && (
            <Badge variant="secondary" className="text-xs font-medium">
              <FileText className="mr-1 h-3 w-3" />
              {doc.product_type}
            </Badge>
          )}
          {doc.submission_type && (
            <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
              {doc.submission_type}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm text-muted-foreground">
          {doc.manufacturer && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{doc.manufacturer}</span>
            </div>
          )}
          {doc.din && (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs">DIN:</span>
              <span className="truncate font-mono text-xs">{doc.din}</span>
            </div>
          )}
          {authDate && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 shrink-0" />
              <span>
                <span className="font-medium text-foreground">Authorization:</span>{" "}
                {formatDate(authDate)}
              </span>
            </div>
          )}
          {doc.control_number && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs">Control #:</span>
              <span className="font-mono text-xs">{doc.control_number}</span>
            </div>
          )}
        </div>

        {/* Indication Summary */}
        {doc.indication_summary && doc.indication_summary !== 'Not available for this document type' && (
          <div className="pt-2 border-t border-border/40">
            <div className="flex items-start gap-2">
              <Pill className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
              <div>
                <span className="text-xs font-semibold text-foreground">Indication:</span>
                <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                  {doc.indication_summary}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
