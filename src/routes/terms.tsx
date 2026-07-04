import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  component: TermsPage,
  head: () => ({
    meta: [
      { title: "Terms of Service — Tarot Seed" },
      {
        name: "description",
        content: "The terms that govern your use of Tarot Seed.",
      },
    ],
  }),
});

/**
 * v2.68 — Terms of Service page (/terms).
 *
 * IMPORTANT: Good-faith starting DRAFT, not legal advice. Have it reviewed by a
 * lawyer before relying on it. Per the owner's instructions: entity "Tarot
 * Seed", contact mark@tarotseed.com, effective July 3, 2026, governing law
 * Texas (Livingston, Texas), credits generally non-refundable (reviewed
 * case-by-case), and a reflection/entertainment (not professional advice) + 18+
 * disclaimer.
 */

const EFFECTIVE_DATE = "July 3, 2026";
const CONTACT_EMAIL = "mark@tarotseed.com";
const GOVERNING_LAW = "the State of Texas";
const VENUE = "Livingston, Texas";

function TermsPage() {
  return (
    <div
      style={{
        height: "100dvh",
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
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
          Terms of Service
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

        <TermsBody />
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

function TermsBody() {
  return (
    <>
      <p style={{ fontFamily: "var(--font-serif)", fontSize: "var(--text-body)", lineHeight: 1.6, marginBottom: 24 }}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the Tarot Seed
        website and app (the &ldquo;Service&rdquo;), provided by Tarot Seed (&ldquo;Tarot Seed,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;). By creating an account or using the
        Service, you agree to these Terms. If you do not agree, do not use the Service.
      </p>

      <Section title="1. Eligibility">
        <p>
          You must be at least 18 years old to use the Service. By using it, you represent that you are
          18 or older and able to enter into these Terms.
        </p>
      </Section>

      <Section title="2. For reflection and entertainment only">
        <p>
          Tarot Seed is a tarot journaling and reflection tool. All readings, patterns, and
          interpretations &mdash; including those generated with the help of artificial intelligence
          &mdash; are provided for personal reflection and entertainment purposes only. They are not
          professional advice and are not a substitute for the guidance of a qualified professional. Do
          not rely on the Service for medical, legal, financial, psychological, or other professional
          decisions. Any actions you take based on the Service are your own responsibility. If you are
          in crisis or need help, please contact a qualified professional or your local emergency
          services.
        </p>
      </Section>

      <Section title="3. Your account">
        <p>
          You are responsible for the information you provide, for keeping your login credentials
          secure, and for all activity that occurs under your account. Notify us promptly at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--accent, var(--gold))", textDecoration: "none" }}>
            {CONTACT_EMAIL}
          </a>{" "}
          if you suspect unauthorized use of your account.
        </p>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>Use the Service for any unlawful purpose or in violation of these Terms;</li>
          <li style={{ marginTop: 4 }}>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the Service or its systems;</li>
          <li style={{ marginTop: 4 }}>Abuse, overload, or attempt to circumvent usage limits, credits, or security measures;</li>
          <li style={{ marginTop: 4 }}>Upload content that infringes others&rsquo; rights or is unlawful, harmful, or abusive;</li>
          <li style={{ marginTop: 4 }}>Use the Service to build a competing product or to scrape or harvest data.</li>
        </ul>
      </Section>

      <Section title="5. Credits, payments, and refunds">
        <p>
          Certain features use credits, which you may purchase in packs through our payment processor,
          Stripe. Prices are shown at the time of purchase. Credits are consumed when you use paid AI
          features and are <strong>generally non-refundable</strong> once purchased. That said, if you
          believe a charge was made in error or you have a concern, contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--accent, var(--gold))", textDecoration: "none" }}>
            {CONTACT_EMAIL}
          </a>{" "}
          and we will review refund requests on a case-by-case basis at our discretion. We may change
          pricing, credit costs, or pack contents going forward; changes do not affect credits you have
          already purchased.
        </p>
      </Section>

      <Section title="6. AI-generated content">
        <p>
          Interpretations and insights are produced with the assistance of third-party AI (Anthropic)
          and may be inaccurate, incomplete, or inconsistent. AI output is generated automatically and
          does not represent the views of Tarot Seed. You are responsible for how you use it, subject
          to the reflection-and-entertainment disclaimer above.
        </p>
      </Section>

      <Section title="7. Your content">
        <p>
          You retain ownership of the readings, notes, and other content you create in the Service. You
          grant us a limited license to store, process, and display that content solely to operate and
          provide the Service to you (including sending relevant content to our AI provider to generate
          your readings, only when you use AI features). The content that can be sent to the AI is
          limited, and identifying details &mdash; such as your name, email, payment data, and precise
          location &mdash; are never sent to the AI. See our{" "}
          <Link to="/privacy" style={{ color: "var(--accent, var(--gold))", textDecoration: "none" }}>
            Privacy Policy
          </Link>{" "}
          for details on how we handle your data.
        </p>
      </Section>

      <Section title="8. Intellectual property">
        <p>
          The Service, including its software, design, text, and branding, is owned by Tarot Seed and
          protected by intellectual-property laws. Except for your own content, you may not copy,
          modify, distribute, or create derivative works from the Service without our permission.
        </p>
      </Section>

      <Section title="9. Termination">
        <p>
          You may stop using the Service and delete your account at any time. We may suspend or
          terminate your access if you violate these Terms or use the Service in a way that could harm
          us or other users. On termination, your right to use the Service ends; sections that by their
          nature should survive (such as disclaimers, limitation of liability, and governing law) will
          continue to apply.
        </p>
      </Section>

      <Section title="10. Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
          of any kind, whether express or implied, including implied warranties of merchantability,
          fitness for a particular purpose, and non-infringement. We do not warrant that the Service
          will be uninterrupted, error-free, or that any reading or interpretation is accurate or
          suitable for any purpose.
        </p>
      </Section>

      <Section title="11. Limitation of liability">
        <p>
          To the fullest extent permitted by law, Tarot Seed and its owners will not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or for any loss arising
          from your use of (or inability to use) the Service. To the extent we are found liable, our
          total liability will not exceed the amount you paid to us in the three months before the
          event giving rise to the claim.
        </p>
      </Section>

      <Section title="12. Governing law">
        <p>
          These Terms are governed by the laws of {GOVERNING_LAW}, without regard to its conflict-of-law
          rules. You agree that any dispute arising from these Terms or the Service will be resolved in
          the state or federal courts located in or serving {VENUE}, and you consent to their
          jurisdiction.
        </p>
      </Section>

      <Section title="13. Changes to these Terms">
        <p>
          We may update these Terms from time to time. When we do, we will revise the effective date
          above and, where appropriate, provide additional notice. Your continued use of the Service
          after changes take effect means you accept the updated Terms.
        </p>
      </Section>

      <Section title="14. Contact us">
        <p>
          Questions about these Terms? Contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "var(--accent, var(--gold))", textDecoration: "none" }}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>
    </>
  );
}
