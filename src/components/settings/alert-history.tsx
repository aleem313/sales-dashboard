import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Alert } from "@/lib/types";

export function AlertHistory({ alerts }: { alerts: Alert[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Alert History</CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Threshold</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-mono text-xs">
                      {alert.alert_type}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm">
                      {alert.message}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {alert.current_value != null
                        ? alert.current_value
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {alert.threshold_value != null
                        ? alert.threshold_value
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap">
                      {new Date(alert.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={alert.dismissed ? "secondary" : "destructive"}>
                        {alert.dismissed ? "Dismissed" : "Active"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
