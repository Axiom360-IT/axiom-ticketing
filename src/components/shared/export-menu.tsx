"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Download,
  FileSpreadsheet,
  FileText,
  FileType,
  type LucideIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPORT_FORMATS, type ExportFormat } from "@/lib/export/dataset";
import { cn } from "@/lib/utils";

const FORMAT_ICON: Record<ExportFormat, LucideIcon> = {
  pdf: FileText,
  xlsx: FileSpreadsheet,
  csv: FileType,
};

/**
 * A drop-in export button: opens a menu of the supported formats, each a link
 * to `baseHref?format=<fmt>` (with any `params` preserved, so a filtered list
 * exports exactly what's on screen). Downloads are ordinary navigations — the
 * route replies with a `Content-Disposition: attachment`, so nothing leaves the
 * page.
 */
export function ExportMenu({
  baseHref,
  params,
  label,
  size = "default",
}: {
  baseHref: string;
  /** Extra query params to preserve (e.g. the active list filters). */
  params?: Record<string, string>;
  label?: string;
  size?: "default" | "sm";
}) {
  const t = useTranslations("common.export");

  const hrefFor = (format: ExportFormat) => {
    const sp = new URLSearchParams(params);
    sp.set("format", format);
    return `${baseHref}?${sp.toString()}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size }))}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {label ?? t("label")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {EXPORT_FORMATS.map((format) => {
          const Icon = FORMAT_ICON[format];
          return (
            <DropdownMenuItem
              key={format}
              render={<Link href={hrefFor(format)} prefetch={false} />}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span>{t(format)}</span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
