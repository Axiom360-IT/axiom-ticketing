"use client";

import { type ChangeEvent, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  commitCustomerImport,
  previewCustomerImport,
  type CommitCustomerImportResult,
  type CustomerImportRowInput,
  type DomainDecision,
  type PreviewResult,
  type PreviewRowStatus,
} from "@/app/actions/customer-import";

type OrgOption = { id: string; name: string };
type Preview = Extract<PreviewResult, { ok: true }>;
type CommitOk = Extract<CommitCustomerImportResult, { ok: true }>;

const STATUS_KEY: Record<PreviewRowStatus, string> = {
  valid: "statusValid",
  duplicate_in_file: "statusDuplicateInFile",
  duplicate_existing_customer: "statusDuplicateCustomer",
  duplicate_existing_staff: "statusDuplicateStaff",
  invalid: "statusInvalid",
};

const STATUS_VARIANT: Record<PreviewRowStatus, "secondary" | "outline" | "destructive"> = {
  valid: "secondary",
  duplicate_in_file: "outline",
  duplicate_existing_customer: "outline",
  duplicate_existing_staff: "destructive",
  invalid: "destructive",
};

/**
 * Minimal CSV/TSV line parser — no quoted-field-with-embedded-delimiter
 * support. Adequate for a name/email/phone list; a genuinely delimiter-
 * heavy export should be cleaned up before pasting.
 */
function parseRows(text: string): CustomerImportRowInput[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitLine = (line: string) =>
    (line.includes("\t") ? line.split("\t") : line.split(","))
      .map((c) => c.trim().replace(/^"(.*)"$/, "$1"));

  let start = 0;
  const first = splitLine(lines[0]).map((c) => c.toLowerCase());
  if (first[0] === "name" && (first[1] ?? "").includes("email")) start = 1;

  const rows: CustomerImportRowInput[] = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitLine(lines[i]);
    rows.push({ name: cols[0] ?? "", email: cols[1] ?? "", phone: cols[2] ?? "" });
  }
  return rows;
}

export function CustomerImportWizard({ organizations }: { organizations: OrgOption[] }) {
  const t = useTranslations("users.import");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"input" | "preview" | "result">("input");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [rows, setRows] = useState<CustomerImportRowInput[]>([]);
  const [decisions, setDecisions] = useState<Record<string, DomainDecision>>({});
  const [result, setResult] = useState<CommitOk | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    e.target.value = "";
  }

  async function handlePreview() {
    setError(null);
    const parsedRows = parseRows(text);
    if (parsedRows.length === 0) {
      setError(t("errorEmptyRows"));
      return;
    }
    setLoading(true);
    const res = await previewCustomerImport(parsedRows);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(parsedRows);
    setPreview(res);
    const initialDecisions: Record<string, DomainDecision> = {};
    for (const g of res.unmatchedDomains) {
      initialDecisions[g.domain] = res.canCreateOrg
        ? {
            type: "create",
            name: g.suggestedName,
            abbreviation: g.suggestedAbbreviation ?? "",
          }
        : { type: "skip" };
    }
    setDecisions(initialDecisions);
    setStep("preview");
  }

  async function handleCommit() {
    setError(null);
    setLoading(true);
    const res = await commitCustomerImport(rows, decisions);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res);
    setStep("result");
  }

  function updateDecision(domain: string, decision: DomainDecision) {
    setDecisions((d) => ({ ...d, [domain]: decision }));
  }

  function reset() {
    setStep("input");
    setText("");
    setPreview(null);
    setRows([]);
    setDecisions({});
    setResult(null);
    setError(null);
  }

  function organizationLabelFor(row: Preview["rows"][number]): string {
    if (row.organizationName) return row.organizationName;
    if (!row.domain) return t("noneDash");
    const decision = decisions[row.domain];
    if (decision?.type === "create") return `${decision.name} ${t("newSuffix")}`;
    if (decision?.type === "assign") {
      return organizations.find((o) => o.id === decision.organizationId)?.name ?? t("noneDash");
    }
    return t("noneDash");
  }

  if (step === "result" && result) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("resultTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {t("resultBody", { count: result.queuedCount })}{" "}
            <Link href="/admin/users?tab=external" className="underline">
              {t("resultCheckLink")}
            </Link>
          </p>
          <ul className="text-sm text-zinc-500 dark:text-zinc-400 space-y-1">
            {result.skippedDuplicate > 0 ? (
              <li>{t("resultSkippedDuplicate", { count: result.skippedDuplicate })}</li>
            ) : null}
            {result.skippedInvalid > 0 ? (
              <li>{t("resultSkippedInvalid", { count: result.skippedInvalid })}</li>
            ) : null}
            {result.skippedNeedsOrg > 0 ? (
              <li>{t("resultSkippedNeedsOrg", { count: result.skippedNeedsOrg })}</li>
            ) : null}
          </ul>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={reset}>
              {t("importAnotherButton")}
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/admin/users?tab=external" />}
            >
              {t("backToUsersButton")}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (step === "preview" && preview) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("reviewCardTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {t("reviewSummary", { valid: preview.validCount, total: preview.rows.length })}
            </p>

            {preview.unmatchedDomains.length > 0 ? (
              <div className="space-y-3 border border-zinc-200 dark:border-zinc-800 rounded-lg p-4">
                <h3 className="text-sm font-medium">
                  {t("domainsHeading", { count: preview.unmatchedDomains.length })}
                </h3>
                {preview.unmatchedDomains.map((group) => {
                  const decision = decisions[group.domain] ?? { type: "skip" as const };
                  return (
                    <div
                      key={group.domain}
                      className="space-y-2 pb-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 last:pb-0"
                    >
                      <p className="text-sm font-medium">
                        {group.domain}{" "}
                        <span className="font-normal text-zinc-500 dark:text-zinc-400">
                          {t("peopleCount", { count: group.rowIndexes.length })}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          className="text-sm border border-zinc-300 dark:border-zinc-700 rounded-md px-2 py-1.5 bg-white dark:bg-zinc-950"
                          value={decision.type}
                          onChange={(e) => {
                            const type = e.target.value as DomainDecision["type"];
                            if (type === "create") {
                              updateDecision(group.domain, {
                                type: "create",
                                name: group.suggestedName,
                                abbreviation: group.suggestedAbbreviation ?? "",
                              });
                            } else if (type === "assign") {
                              updateDecision(group.domain, {
                                type: "assign",
                                organizationId: organizations[0]?.id ?? "",
                              });
                            } else {
                              updateDecision(group.domain, { type: "skip" });
                            }
                          }}
                        >
                          {preview.canCreateOrg ? (
                            <option value="create">{t("optionCreate")}</option>
                          ) : null}
                          <option value="assign">{t("optionAssign")}</option>
                          <option value="skip">{t("optionSkip")}</option>
                        </select>

                        {decision.type === "create" ? (
                          <>
                            <Input
                              className="w-48"
                              value={decision.name}
                              onChange={(e) =>
                                updateDecision(group.domain, {
                                  ...decision,
                                  name: e.target.value,
                                })
                              }
                              placeholder={t("orgNamePlaceholder")}
                            />
                            <Input
                              className="w-28"
                              value={decision.abbreviation}
                              onChange={(e) =>
                                updateDecision(group.domain, {
                                  ...decision,
                                  abbreviation: e.target.value.toUpperCase(),
                                })
                              }
                              placeholder={t("orgCodePlaceholder")}
                              maxLength={5}
                            />
                          </>
                        ) : null}

                        {decision.type === "assign" ? (
                          <Select
                            items={Object.fromEntries(
                              organizations.map((o) => [o.id, o.name]),
                            )}
                            value={decision.organizationId}
                            onValueChange={(v) =>
                              updateDecision(group.domain, {
                                type: "assign",
                                organizationId: v ?? "",
                              })
                            }
                          >
                            <SelectTrigger className="w-56">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {organizations.map((o) => (
                                <SelectItem key={o.id} value={o.id}>
                                  {o.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="overflow-x-auto border border-zinc-200 dark:border-zinc-800 rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("colName")}</TableHead>
                    <TableHead>{t("colEmail")}</TableHead>
                    <TableHead>{t("colOrganization")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row) => (
                    <TableRow key={row.index}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.email}</TableCell>
                      <TableCell className="text-zinc-500 dark:text-zinc-400">
                        {organizationLabelFor(row)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[row.status]}>
                          {t(STATUS_KEY[row.status])}
                        </Badge>
                        {row.error ? (
                          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                            {row.error}
                          </span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {error ? (
              <div
                role="alert"
                className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
              >
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep("input")}>
                {t("backButton")}
              </Button>
              <Button onClick={handleCommit} disabled={loading || preview.validCount === 0}>
                {loading ? t("importing") : t("importButton", { count: preview.validCount })}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pasteCardTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("pasteHint")}</p>
        <div className="space-y-1.5">
          <Label htmlFor="import-text">{t("textareaLabel")}</Label>
          <Textarea
            id="import-text"
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Jamie Client, jamie@kingsmillfoods.com, +14165550123\nAlex Buyer, alex@kingsmillfoods.com"}
            className="font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            {t("uploadButton")}
          </Button>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("uploadOrPaste")}
          </span>
        </div>

        {error ? (
          <div
            role="alert"
            className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 dark:bg-red-950/40 dark:border-red-900 dark:text-red-400"
          >
            {error}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Button onClick={handlePreview} disabled={loading || text.trim().length === 0}>
            {loading ? t("previewing") : t("previewButton")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
