"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addConnectsPurchaseAction, deleteConnectsPurchaseAction } from "@/lib/actions";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import type { ConnectsPurchase, Profile } from "@/lib/types";

function todayInET(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function formatUsd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

interface Props {
  profiles: Profile[];
  purchases: ConnectsPurchase[];
  /** When true, render the admin variant: extra Agent column, delete on every row. */
  isAdmin: boolean;
}

export function ConnectsPurchaseForm({ profiles, purchases, isAdmin }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [profileId, setProfileId] = useState<string>(
    profiles.length === 1 ? profiles[0].profile_id : ""
  );
  const [purchasedOn, setPurchasedOn] = useState<string>(todayInET());
  const [connectsCount, setConnectsCount] = useState<string>("");
  const [amountSpent, setAmountSpent] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const totalPurchased = purchases.reduce((s, p) => s + p.connects_count, 0);
  const totalSpent = purchases.reduce((s, p) => s + p.amount_spent, 0);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const count = parseInt(connectsCount, 10);
    const amount = parseFloat(amountSpent);

    if (!profileId) {
      toast.error("Pick a profile");
      return;
    }
    if (!Number.isFinite(count) || count <= 0) {
      toast.error("Connects must be a positive whole number");
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Amount must be zero or positive");
      return;
    }

    startTransition(async () => {
      try {
        await addConnectsPurchaseAction({
          profileId,
          purchasedOn,
          connectsCount: count,
          amountSpent: amount,
          notes: notes.trim() || undefined,
        });
        toast.success(`Logged ${count} connects (${formatUsd(amount)})`);
        setConnectsCount("");
        setAmountSpent("");
        setNotes("");
        router.refresh();
      } catch (err) {
        toast.error((err as Error).message || "Failed to add purchase");
      }
    });
  }

  function handleDelete(id: string, label: string) {
    if (!confirm(`Delete this purchase entry?\n${label}\nThis cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteConnectsPurchaseAction(id);
      if (result.ok) {
        toast.success("Purchase entry removed");
        router.refresh();
      } else {
        toast.error(
          result.reason === "forbidden" ? "Admin only" : "Entry not found"
        );
      }
    });
  }

  return (
    <div className="rounded-[10px] border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-[18px] py-3.5">
        <div>
          <h3 className="font-heading text-[15px] font-bold tracking-[0.03em]">
            Log a Connects Purchase
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Record connects bought on Upwork — date, count, and amount paid. Updates the budget bars below.
          </p>
        </div>
        <div className="text-right text-[12px] text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground">{totalPurchased.toLocaleString()}</span>{" "}
            connects logged
          </div>
          <div>
            <span className="font-semibold text-foreground">{formatUsd(totalSpent)}</span> spent
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 px-[18px] py-4 md:grid-cols-[2fr_1.2fr_1fr_1fr_1.5fr_auto]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-profile" className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Profile
          </Label>
          <Select value={profileId} onValueChange={setProfileId} disabled={isPending}>
            <SelectTrigger id="cp-profile">
              <SelectValue placeholder="Select profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.profile_id} value={p.profile_id}>
                  {p.profile_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-date" className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Date purchased
          </Label>
          <Input
            id="cp-date"
            type="date"
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
            max={todayInET()}
            disabled={isPending}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-count" className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Connects
          </Label>
          <Input
            id="cp-count"
            type="number"
            min="1"
            step="1"
            value={connectsCount}
            onChange={(e) => setConnectsCount(e.target.value)}
            placeholder="e.g. 60"
            disabled={isPending}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-amount" className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Amount ($)
          </Label>
          <Input
            id="cp-amount"
            type="number"
            min="0"
            step="0.01"
            value={amountSpent}
            onChange={(e) => setAmountSpent(e.target.value)}
            placeholder="e.g. 14.99"
            disabled={isPending}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="cp-notes" className="text-[12px] uppercase tracking-[0.1em] text-muted-foreground">
            Notes (optional)
          </Label>
          <Input
            id="cp-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. weekly top-up"
            disabled={isPending}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[12px] uppercase tracking-[0.1em] text-transparent select-none">.</span>
          <Button type="submit" disabled={isPending || !profileId}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>
      </form>

      <div className="border-t border-border">
        <div className="px-[18px] py-3">
          <h4 className="font-heading text-[13.5px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
            {isAdmin ? "All purchases" : "Recent purchases"}
          </h4>
        </div>
        {purchases.length === 0 ? (
          <div className="px-[18px] pb-5 text-[13.5px] text-muted-foreground">
            No purchases recorded yet for the selected range.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                {isAdmin && <TableHead>Agent</TableHead>}
                <TableHead>Profile</TableHead>
                <TableHead className="text-right">Connects</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Logged by</TableHead>
                {isAdmin && <TableHead className="w-[60px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchases.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.purchased_on}</TableCell>
                  {isAdmin && <TableCell>{p.agent_name ?? "—"}</TableCell>}
                  <TableCell>{p.profile_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.connects_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(p.amount_spent)}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">
                    {p.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.created_by_name ?? "Admin"}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          handleDelete(
                            p.id,
                            `${p.profile_name} · ${p.purchased_on} · ${p.connects_count} connects · ${formatUsd(p.amount_spent)}`
                          )
                        }
                        disabled={isPending}
                        aria-label="Delete purchase"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
