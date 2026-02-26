import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/utils";
import type { SyncLog } from "@/lib/types";

export function SyncLogTable({ logs }: { logs: SyncLog[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Sync History</CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sync runs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Synced</TableHead>
                <TableHead className="hidden sm:table-cell">Updated</TableHead>
                <TableHead>Time</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-medium">{log.source}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        log.status === "success"
                          ? "default"
                          : log.status === "running"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {log.records_synced}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {log.records_updated}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRelativeTime(log.started_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
