import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { getTranslations } from "next-intl/server";

type LayoutProps = {
  preview: string;
  title: string;
  children: React.ReactNode;
  ticketNumber?: string;
  locale: string;
};

const styles = {
  body: {
    backgroundColor: "#f4f5f7",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    margin: "0",
    padding: "0",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e4e7eb",
    borderRadius: "8px",
    margin: "32px auto",
    maxWidth: "560px",
    padding: "32px",
  },
  heading: {
    color: "#0f172a",
    fontSize: "20px",
    fontWeight: 600,
    lineHeight: "1.3",
    margin: "0 0 16px",
  },
  ticketBadge: {
    backgroundColor: "#eef2ff",
    border: "1px solid #c7d2fe",
    borderRadius: "4px",
    color: "#1e3a8a",
    display: "inline-block",
    fontFamily:
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: "12px",
    fontWeight: 500,
    marginBottom: "16px",
    padding: "3px 8px",
  },
  footer: {
    color: "#64748b",
    fontSize: "12px",
    lineHeight: "1.5",
    margin: "0",
  },
  hr: {
    border: "none",
    borderTop: "1px solid #e4e7eb",
    margin: "24px 0",
  },
};

export async function EmailLayout({
  preview,
  title,
  children,
  ticketNumber,
  locale,
}: LayoutProps) {
  const t = await getTranslations({ locale, namespace: "emails.shared" });
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          {ticketNumber && (
            <span style={styles.ticketBadge}>{ticketNumber}</span>
          )}
          <Heading style={styles.heading}>{title}</Heading>
          {children}
          <Hr style={styles.hr} />
          <Section>
            <Text style={styles.footer}>
              {t("footerLine1")}
              <br />
              {t("footerLine2")}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export const textStyles = {
  body: {
    color: "#334155",
    fontSize: "14px",
    lineHeight: "1.6",
    margin: "0 0 12px",
  },
  meta: {
    color: "#64748b",
    fontSize: "13px",
    lineHeight: "1.5",
    margin: "12px 0",
  },
  button: {
    backgroundColor: "#1e40af",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 500,
    margin: "12px 0",
    padding: "10px 18px",
    textDecoration: "none",
  },
  buttonGood: {
    backgroundColor: "#15803d",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 500,
    marginRight: "8px",
    padding: "10px 18px",
    textDecoration: "none",
  },
  buttonBad: {
    backgroundColor: "#b91c1c",
    borderRadius: "6px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "14px",
    fontWeight: 500,
    padding: "10px 18px",
    textDecoration: "none",
  },
};
