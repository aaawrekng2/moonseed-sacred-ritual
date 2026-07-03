import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  component: PrivacyPage,
  head: () => ({
    meta: [
      { title: "Privacy Policy — Tarot Seed" },
      {
        name: "description",
        content: "How Tarot Seed collects, uses, and protects your data.",
      },
    ],
  }),
});

/**
 * v2.67 — Privacy Policy page (/privacy).
 *
 * IMPORTANT: This is a good-faith starting draft describing Tarot Seed's data
 * practices across its stack (Supabase, Stripe, the Anthropic/Claude API,
 * Google sign-in, cookies/local storage). It is NOT legal advice. Have it
 * reviewed by a lawyer before relying on it for compliance or Google OAuth
 * verification. Entity name, contact email (mark@tarotseed.com), and the
 * effective date (July 3, 2026) are set per the owner's instruction.
 */

const EFFECTIVE_DATE = "July 3, 2026";
const CONTACT_EMAIL = "mark@tarotseed.com";

function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--color-background, #12061f)",
        color: "var(--color-foreground)",
        padding: "40px 20px 80px",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <Link
          to="/"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--accent, var(--gold))",
            textDecoration: "none",
          }}
        >
          &larr; Back to Tarot Seed
        </Link>

        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--text-display)",
            margin: "18px 0 4px",
            lineHeight: 1.15,
          }}
        >
          Privacy Policy
        </h1>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            color: "var(--color-foreground-muted)",
            marginBottom: 28,
          }}
        >
          Effective {EFFECTIVE_DATE}
        </p>

        <PolicyBody />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--text-heading-md)",
          margin: "0 0 8px",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body)",
          lineHeight: 1.6,
          color: "var(--color-foreground)",
        }}
      >
        {children}
      </div>
    </section>
  );
}

function PolicyBody() {
  return (
    <>
      <p style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-body)", lineHeight: 1.6, marginBottom: 24 }}>
        This Privacy Policy explains how Tarot Seed (&ldquo;Tarot Seed,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, shares, and protects information about
        you when you use the Tarot Seed website and app (the &ldquo;Service&rdquo;). By using the
        Service, you agree to the practices described here.
      </p>

      <Section title="Information we collect">
        <p>We collect the following categories of information:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Account information.</strong> When you create an account, we collect your email
            address and, if you sign in with Google, your name, email, and profile picture as provided
            by Google.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Your readings and journal content.</strong> The cards you log, spreads, questions,
            notes, tags, and other content you create in the Service.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Payment information.</strong> If you purchase credits or a subscription, payments
            are processed by Stripe. We do not store your full card number; Stripe handles that
            directly. We receive limited transaction details (such as amount, status, and a customer
            identifier).
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Usage and device data.</strong> Basic technical information such as your device
            type, browser, time zone, and how you interact with the Service, used to operate and
            improve it.
          </li>
        </ul>
      </Section>

      <Section title="How we use your information">
        <p>We use your information to:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Provide, maintain, and improve the Service;</li>
          <li style={{ marginTop: 4 }}>Create and secure your account and authenticate sign-in;</li>
          <li style={{ marginTop: 4 }}>
            Generate the patterns, insights, and AI-assisted interpretations you request;
          </li>
          <li style={{ marginTop: 4 }}>Process payments and manage credits;</li>
          <li style={{ marginTop: 4 }}>Communicate with you about your account and the Service;</li>
          <li style={{ marginTop: 4 }}>Protect against fraud, abuse, and security threats.</li>
        </ul>
      </Section>

      <Section title="AI processing of your content">
        <p>
          When you request an interpretation or reading, the relevant content (such as the cards drawn
          and your question) is sent to our AI provider, Anthropic, to generate a response. This
          content is transmitted securely and used to produce your reading. We do not sell your
          content, and we ask our providers to handle it in accordance with their terms and applicable
          law.
        </p>
      </Section>

      <Section title="How we share information">
        <p>
          We do not sell your personal information. We share information only with service providers
          who help us operate the Service, and only as needed for them to perform their functions:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Supabase</strong> &mdash; database, storage, and authentication (hosts your account
            and reading data).
          </li>
          <li style={{ marginTop: 4 }}>
            <strong>Stripe</strong> &mdash; payment processing.
          </li>
          <li style={{ marginTop: 4 }}>
            <strong>Anthropic</strong> &mdash; AI processing for interpretations.
          </li>
          <li style={{ marginTop: 4 }}>
            <strong>Google</strong> &mdash; if you choose to sign in with Google.
          </li>
        </ul>
        <p style={{ marginTop: 8 }}>
          We may also disclose information if required by law, to enforce our terms, or to protect the
          rights, safety, and security of our users and the Service.
        </p>
      </Section>

      <Section title="Cookies and local storage">
        <p>
          We use cookies and browser local storage to keep you signed in, remember your preferences,
          and operate core features of the Service. You can control cookies through your browser
          settings, but some features may not work properly if you disable them.
        </p>
      </Section>

      <Section title="Data retention and deletion">
        <p>
          We keep your information for as long as your account is active or as needed to provide the
          Service. You can delete your readings and data, or request deletion of your account, from
          within the app&rsquo;s settings or by contacting us. When you delete data, we remove it from
          our active systems; some information may persist briefly in backups before being overwritten.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Depending on where you live, you may have rights to access, correct, export, or delete your
          personal information, and to object to or restrict certain processing. You can exercise many
          of these directly in the app, or by emailing us at the address below. We will respond in
          accordance with applicable law.
        </p>
      </Section>

      <Section title="Security">
        <p>
          We use reasonable technical and organizational measures to protect your information,
          including encrypted connections and access controls. No method of transmission or storage is
          completely secure, so we cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="Children">
        <p>
          The Service is not directed to children under 13 (or the minimum age required in your
          jurisdiction), and we do not knowingly collect personal information from them. If you believe
          a child has provided us information, please contact us and we will take appropriate steps.
        </p>
      </Section>

      <Section title="International users">
        <p>
          Tarot Seed and its service providers may store and process your information in the United
          States and other countries. By using the Service, you understand your information may be
          transferred to and processed in locations with different data-protection laws than your own.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this Privacy Policy from time to time. When we do, we will revise the effective
          date above and, where appropriate, provide additional notice. Your continued use of the
          Service after changes take effect means you accept the updated policy.
        </p>
      </Section>

      <Section title="Contact us">
        <p>
          If you have questions or requests about this Privacy Policy or your information, contact us
          at{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            style={{ color: "var(--accent, var(--gold))", textDecoration: "none" }}
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </>
  );
}
