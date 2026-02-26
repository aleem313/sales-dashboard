import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/types";

function statusVariant(status: string, outcome: string | null) {
  if (outcome === "won") return "default" as const;
  if (outcome === "lost") return "destructive" as const;
  if (status === "Sent" || status === "Following Up") return "secondary" as const;
  return "outline" as const;
}

function displayStatus(status: string, outcome: string | null) {
  if (outcome === "won") return "Won";
  if (outcome === "lost") return "Lost";
  if (outcome === "skipped") return "Skipped";
  return status;
}

export function RecentActivityTable({ events }: { events: ActivityEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead className="hidden sm:table-cell">Agent</TableHead>
              <TableHead className="hidden md:table-cell">Profile</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <div className="font-medium max-w-[200px] truncate">
                    {event.job_title}
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {event.agent_name ?? "—"}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {event.profile_name ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={statusVariant(event.clickup_status, event.outcome)}>
                    {displayStatus(event.clickup_status, event.outcome)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">
                  {formatRelativeTime(event.updated_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
