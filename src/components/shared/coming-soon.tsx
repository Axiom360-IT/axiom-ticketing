import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";

type ComingSoonProps = {
  title: string;
  description: string;
  module: string;
};

export async function ComingSoon({
  title,
  description,
  module,
}: ComingSoonProps) {
  const t = await getTranslations("admin.comingSoon");
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
      </div>
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            {description}
          </p>
          <p className="mt-3 text-xs text-zinc-400 font-mono">
            {t("buildsIn", { module })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
