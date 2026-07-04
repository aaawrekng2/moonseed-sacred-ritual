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
        <p>We collect the following, most of which you enter yourself:</p>
        <ul style={{ paddingLeft: 20, marginTop: 8 }}>
          <li>
            <strong>Account &amp; identity.</strong> Your email address (from email or Google
            sign-up); if you use Google, your Google name, email, and profile picture; a display name
            you choose; and, if you enable it, multi-factor authentication with recovery codes.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Birth &amp; astrology details (optional).</strong> If you use the astrology
            features, the birth date, time, place, and name you provide, and derived details such as
            sun and rising signs.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Readings &amp; journal content.</strong> The cards you log and their orientations,
            the deck used, your questions and intentions, free-text notes, tags, spread type,
            favorites, and the moon phase at draw time; reflections and revisit answers; and the AI
            interpretations generated for your readings.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Photos &amp; uploads.</strong> Spread photos you upload (and any captions); custom
            deck images and the deck/card names, descriptions, prompts, and dimensions you enter; and
            content you bring in through bulk imports from other apps.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Patterns &amp; memory.</strong> Information the Service derives from your activity —
            card frequencies, recurring tags, co-occurrence patterns, streaks, and summaries of your
            patterns used to personalize the experience.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Preferences &amp; settings.</strong> Your theme, fonts, sizes, and display options;
            AI and moon feature settings; default spread and related choices; and your time zone.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Payments.</strong> If you buy credits, a Stripe customer identifier and your
            subscription/premium status. Full card details are handled by Stripe and are not stored by
            us.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Communications.</strong> An optional notification email you provide, and records of
            transactional emails we send you (with unsubscribe options).
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Feedback.</strong> Any feedback posts or votes you submit.
          </li>
          <li style={{ marginTop: 6 }}>
            <strong>Technical data.</strong> Timestamps and your device time zone, and browser local
            storage used to keep your preferences and in-progress question. We do not use third-party
            advertising or cross-site tracking.
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

      <Section title="How AI features use your data">
        <p>
          Some features use artificial intelligence (provided by Anthropic) to generate readings,
          reflections, and prompts. AI is only involved <strong>when you choose to use an AI feature</strong>.
          If you do not use AI features, none of your content is sent to the AI provider.
        </p>
        <p style={{ marginTop: 10 }}>
          <strong>What may be sent to the AI, only when you use AI features:</strong>
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>The reading you are working with — the cards and orientations, spread, and the moon phase.</li>
          <li style={{ marginTop: 4 }}>The question and notes you typed for that reading.</li>
          <li style={{ marginTop: 4 }}>
            A memory summary (card frequencies, recent tags, and pattern summaries) &mdash; only if you
            have turned on the memory permission in settings.
          </li>
          <li style={{ marginTop: 4 }}>
            For deep readings only: your birth date and time, and your birth place as a city name.
          </li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>What is never sent to the AI.</strong> The following are blocked from AI requests in
          our software and are never transmitted to the AI provider:
        </p>
        <ul style={{ paddingLeft: 20, marginTop: 6 }}>
          <li>Your name (real name, display name, or birth name);</li>
          <li style={{ marginTop: 4 }}>Your email address or any contact address;</li>
          <li style={{ marginTop: 4 }}>Your password, login tokens, or MFA recovery codes;</li>
          <li style={{ marginTop: 4 }}>Any payment or card data, and your Stripe/billing identifiers;</li>
          <li style={{ marginTop: 4 }}>Precise geographic coordinates (exact latitude/longitude);</li>
          <li style={{ marginTop: 4 }}>Your account identifiers, IP address, and device identifiers;</li>
          <li style={{ marginTop: 4 }}>Your uploaded photos and deck images.</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          <strong>Your controls.</strong> You can turn AI features on or off, and turn the memory
          permission on or off, in Settings. Turning AI features off means your content is not sent to
          the AI provider. AI output is generated automatically and may be inaccurate; it is provided
          for reflection and entertainment, not professional advice.
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
