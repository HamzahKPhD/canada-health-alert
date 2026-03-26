import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, CheckCircle2, AlertCircle } from "lucide-react";

interface ScanLog {
  id: string;
  scanned_at: string;
  new_documents_count: number;
  total_documents_count: number;
  status: string;
}

interface ScanStatusProps {
  lastScan: ScanLog | null;
  isScanning: boolean;
  onScan: () => void;
}

export function ScanStatus({ lastScan, isScanning, onScan }: ScanStatusProps) {
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-4 rounded-lg bg-card border border-border/60">
      <div className="flex items-center gap-2 flex-1">
        {lastScan ? (
          <>
            {lastScan.status === "success" ? (
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--new-badge))]" />
            ) : (
              <AlertCircle className="h-4 w-4 text-destructive" />
            )}
            <span className="text-sm text-muted-foreground">
              Last scan:{" "}
              <span className="font-medium text-foreground">
                {formatTime(lastScan.scanned_at)}
              </span>
            </span>
            {lastScan.new_documents_count > 0 && (
              <Badge className="bg-[hsl(var(--new-badge))] text-[hsl(var(--new-badge-foreground))] text-xs">
                +{lastScan.new_documents_count} new
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              <Clock className="inline h-3 w-3 mr-0.5" />
              Scans daily
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">
            No scans yet — run your first scan
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onScan}
        disabled={isScanning}
        className="shrink-0"
      >
        <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isScanning ? "animate-spin" : ""}`} />
        {isScanning ? "Scanning..." : "Scan Now"}
      </Button>
    </div>
  );
}
