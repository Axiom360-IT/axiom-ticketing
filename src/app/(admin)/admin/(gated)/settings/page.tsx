import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandingForm } from "@/components/settings/branding-form";
import { BusinessHoursForm } from "@/components/settings/business-hours-form";
import { HolidaysList } from "@/components/settings/holidays-list";
import { RateLimitForm } from "@/components/settings/rate-limit-form";
import {
  BooleanSettingForm,
  NumberSettingForm,
  SelectSettingForm,
  StringSettingForm,
} from "@/components/settings/scalar-form";
import { SlaTargetsForm } from "@/components/settings/sla-form";
import { StringListForm } from "@/components/settings/string-list-form";
import { loadSettingsSnapshot } from "@/app/actions/settings";
import { DEFAULT_BRANDING, isAccentKey, isGradientKey } from "@/lib/branding/presets";
import { can } from "@/lib/auth/can";
import { productionContext } from "@/lib/auth/can-context";
import { getSessionUser } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

const PUBLIC_RATE_LIMITS = [
  "rate_limits.public_submit",
  "rate_limits.login",
  "rate_limits.password_reset",
  "rate_limits.guest_portal",
] as const;

const AUTH_RATE_LIMITS = [
  "rate_limits.authenticated.create_ticket",
  "rate_limits.authenticated.reply",
  "rate_limits.authenticated.internal_note",
  "rate_limits.authenticated.escalate",
  "rate_limits.authenticated.create_proc",
  "rate_limits.authenticated.create_user",
  "rate_limits.authenticated.create_role",
  "rate_limits.authenticated.update_setting",
] as const;

const SETTINGS_TABS = [
  "operations",
  "tickets",
  "email",
  "security",
  "branding",
] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

function num(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function rateLimitObj(v: unknown): Record<string, number> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const out: Record<string, number> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === "number") out[k] = val;
    }
    return out;
  }
  return {};
}

type SearchParams = Promise<{ tab?: string }>;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/admin/login");
  if (
    !(await can(user, "settings.view", { type: "global" }, productionContext))
  ) {
    redirect("/admin");
  }

  const sp = await searchParams;
  const tab: SettingsTab = (SETTINGS_TABS as readonly string[]).includes(
    sp.tab ?? "",
  )
    ? (sp.tab as SettingsTab)
    : "operations";

  const snapshot = await loadSettingsSnapshot();
  const v = snapshot.values;

  const t = await getTranslations("settings.page");
  const tBh = await getTranslations("settings.businessHours");
  const tSla = await getTranslations("settings.sla");
  const tHol = await getTranslations("settings.holidays");
  const tDom = await getTranslations("settings.domains");
  const tProc = await getTranslations("settings.procurement");
  const tRw = await getTranslations("settings.responseWindow");
  const tEm = await getTranslations("settings.emails");
  const tFu = await getTranslations("settings.fileUpload");
  const tVs = await getTranslations("settings.virusScan");
  const tRl = await getTranslations("settings.rateLimits");

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t("subtitle")}
        </p>
      </header>

      <nav
        aria-label={t("title")}
        className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800 -mt-2"
      >
        <SettingsTabLink tab="operations" active={tab === "operations"} label={t("tabOperations")} />
        <SettingsTabLink tab="tickets" active={tab === "tickets"} label={t("tabTickets")} />
        <SettingsTabLink tab="email" active={tab === "email"} label={t("tabEmail")} />
        <SettingsTabLink tab="security" active={tab === "security"} label={t("tabSecurity")} />
        <SettingsTabLink tab="branding" active={tab === "branding"} label={t("tabBranding")} />
      </nav>

      {/* ── Operations ─────────────────────────────────────────────── */}
      {tab === "operations" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tBh("title")}</CardTitle>
              <CardDescription>{tBh("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <BusinessHoursForm
                initial={{
                  timezone: str(v["business_hours.timezone"], "UTC"),
                  startHour: num(v["business_hours.start_hour"], 9),
                  endHour: num(v["business_hours.end_hour"], 18),
                  workingDays: strArr(v["business_hours.working_days"]),
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tSla("title")}</CardTitle>
              <CardDescription>{tSla("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <SlaTargetsForm
                initial={{
                  critical: {
                    responseMinutes: num(v["sla.critical.response_minutes"], 60),
                    resolveMinutes: num(v["sla.critical.resolve_minutes"], 240),
                    respectBusinessHours: bool(
                      v["sla.critical.respect_business_hours"],
                      false,
                    ),
                  },
                  high: {
                    responseMinutes: num(v["sla.high.response_minutes"], 240),
                    resolveMinutes: num(v["sla.high.resolve_minutes"], 1440),
                    respectBusinessHours: bool(
                      v["sla.high.respect_business_hours"],
                      true,
                    ),
                  },
                  medium: {
                    responseMinutes: num(v["sla.medium.response_minutes"], 480),
                    resolveMinutes: num(v["sla.medium.resolve_minutes"], 2880),
                    respectBusinessHours: bool(
                      v["sla.medium.respect_business_hours"],
                      true,
                    ),
                  },
                  low: {
                    responseMinutes: num(v["sla.low.response_minutes"], 1440),
                    resolveMinutes: num(v["sla.low.resolve_minutes"], 7200),
                    respectBusinessHours: bool(
                      v["sla.low.respect_business_hours"],
                      true,
                    ),
                  },
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tHol("title")}</CardTitle>
              <CardDescription>{tHol("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <HolidaysList initial={snapshot.holidays} />
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ── Tickets ────────────────────────────────────────────────── */}
      {tab === "tickets" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tRw("title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <NumberSettingForm
                settingKey="customer_response_window_hours"
                label={tRw("label")}
                initial={num(v["customer_response_window_hours"], 24)}
                min={1}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tProc("title")}</CardTitle>
            </CardHeader>
            <CardContent>
              <NumberSettingForm
                settingKey="procurement_approval_threshold"
                label={tProc("thresholdLabel")}
                hint={tProc("thresholdHint")}
                initial={num(v["procurement_approval_threshold"], 0)}
                min={0}
                step={0.01}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tDom("title")}</CardTitle>
              <CardDescription>{tDom("subtitle")}</CardDescription>
            </CardHeader>
            <CardContent>
              <StringListForm
                settingKey="internal_email_domains"
                initial={strArr(v["internal_email_domains"])}
                i18nNamespace="settings.domains"
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ── Email ──────────────────────────────────────────────────── */}
      {tab === "email" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tEm("title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <StringSettingForm
                settingKey="support_email"
                label={tEm("supportEmail")}
                initial={str(v["support_email"], "")}
                type="email"
              />
              <StringSettingForm
                settingKey="inbound_email_domain"
                label={tEm("inboundDomain")}
                hint={tEm("inboundDomainHint")}
                initial={str(v["inbound_email_domain"], "")}
                readOnly={Boolean(v["inbound_email_domain"])}
              />
              <StringSettingForm
                settingKey="default_sender_name"
                label={tEm("defaultSenderName")}
                initial={str(v["default_sender_name"], "")}
                maxLength={120}
              />
              <StringSettingForm
                settingKey="default_sender_email"
                label={tEm("defaultSenderEmail")}
                initial={str(v["default_sender_email"], "")}
                type="email"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tEm("allowlistTitle")}</CardTitle>
              <CardDescription>{tEm("allowlistDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <BooleanSettingForm
                settingKey="inbound_sender_allowlist_only"
                label={tEm("allowlistToggle")}
                initial={bool(v["inbound_sender_allowlist_only"], false)}
              />
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ── Security ───────────────────────────────────────────────── */}
      {tab === "security" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{tFu("title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <NumberSettingForm
                settingKey="file_upload.max_size_bytes"
                label={tFu("maxSizeLabel")}
                hint={tFu("maxSizeHint")}
                initial={num(v["file_upload.max_size_bytes"], 10_485_760)}
                min={1}
              />
              <div>
                <p className="text-sm font-medium mb-1.5">
                  {tFu("mimeTypesLabel")}
                </p>
                <StringListForm
                  settingKey="file_upload.allowed_mime_types"
                  initial={strArr(v["file_upload.allowed_mime_types"])}
                  i18nNamespace="settings.fileUpload"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tVs("title")}</CardTitle>
              <CardDescription>{tVs("description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <BooleanSettingForm
                settingKey="virus_scan.enabled"
                label={tVs("enabled")}
                initial={bool(v["virus_scan.enabled"], false)}
              />
              <SelectSettingForm
                settingKey="virus_scan.provider"
                label={tVs("providerLabel")}
                hint={tVs("providerHint")}
                initial={str(v["virus_scan.provider"], "disabled")}
                options={[
                  { value: "disabled", label: tVs("providerDisabled") },
                  { value: "eicar", label: tVs("providerEicar") },
                  { value: "clamav-rest", label: tVs("providerClamavRest") },
                ]}
              />
              <StringSettingForm
                settingKey="virus_scan.endpoint"
                label={tVs("endpointLabel")}
                hint={tVs("endpointHint")}
                initial={str(v["virus_scan.endpoint"], "")}
                optional
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tRl("publicTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {PUBLIC_RATE_LIMITS.map((k) => (
                <RateLimitForm
                  key={k}
                  settingKey={k}
                  initial={rateLimitObj(v[k])}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{tRl("authTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {AUTH_RATE_LIMITS.map((k) => (
                <RateLimitForm
                  key={k}
                  settingKey={k}
                  initial={rateLimitObj(v[k])}
                />
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ── Branding ───────────────────────────────────────────────── */}
      {tab === "branding" ? (
        <Card>
          <CardHeader>
            <CardTitle>{(await getTranslations("settings.branding"))("title")}</CardTitle>
            <CardDescription>
              {(await getTranslations("settings.branding"))("subtitle")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingForm
              initial={(() => {
                const raw = v["branding"];
                const obj = raw && typeof raw === "object" && !Array.isArray(raw)
                  ? (raw as Record<string, unknown>)
                  : {};
                return {
                  brandName:
                    typeof obj.brandName === "string" && obj.brandName.length > 0
                      ? obj.brandName
                      : DEFAULT_BRANDING.brandName,
                  brandAccent:
                    typeof obj.brandAccent === "string"
                      ? obj.brandAccent
                      : DEFAULT_BRANDING.brandAccent,
                  accentColor: isAccentKey(obj.accentColor)
                    ? obj.accentColor
                    : DEFAULT_BRANDING.accentColor,
                  gradientPreset: isGradientKey(obj.gradientPreset)
                    ? obj.gradientPreset
                    : DEFAULT_BRANDING.gradientPreset,
                };
              })()}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SettingsTabLink({
  tab,
  active,
  label,
}: {
  tab: SettingsTab;
  active: boolean;
  label: string;
}) {
  return (
    <Link
      href={`/admin/settings?tab=${tab}`}
      aria-current={active ? "page" : undefined}
      className={cn(
        "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-blue-600 text-blue-700 dark:border-blue-500 dark:text-blue-400"
          : "border-transparent text-zinc-600 hover:text-zinc-900 hover:border-zinc-300 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:border-zinc-700",
      )}
    >
      {label}
    </Link>
  );
}
