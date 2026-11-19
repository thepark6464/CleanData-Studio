import React from 'react';

export const PrivacyPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <div className="space-y-2">
        <p className="text-xs font-medium text-blue-800">Privacy &amp; Data Handling</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">
          Privacy Policy (Draft for Legal Review)
        </h1>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
        <strong>Legal Review Notice:</strong> This policy and terms document are structured product drafts and are not a substitute for formal compliance or legal advice. Obtain qualified legal review for your target jurisdictions (such as India DPDP Act, EU GDPR, and US state privacy laws) prior to public launch.
      </div>

      <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700">
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            1. Browser-Only vs. Server Processing Paths
          </h2>
          <p>
            <strong>Browser Processing Path (Active Now):</strong> Files up to 5 MB processed in CleanData Studio run entirely inside your local browser memory. File contents, cell values, and generated exports are never transmitted to any server and are never logged.
          </p>
          <p>
            <strong>Server Processing Path (Phase 3+ API &amp; Large Files):</strong> When you explicitly submit a file to the server API or exceed browser limits, files are stored temporarily in private object storage using random UUID object names and accessed via short-lived signed links.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            2. No AI Model Training &amp; No Raw Content Logging
          </h2>
          <p>
            Customer files and dataset row contents are never used to train AI or machine-learning models. Application logs record request IDs, operational status codes, and aggregate row counts only—never row contents, emails, phone numbers, API secrets, or payment details.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            3. Retention &amp; Deletion Schedule (Server Path)
          </h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Uploaded input files: automatically deleted 24 hours after job completion.</li>
            <li>Cleaned output artifacts: automatically deleted 7 days after generation.</li>
            <li>Job metadata, quality-score reports, and billing records: retained until account deletion (subject to statutory billing retention requirements).</li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            4. Security Disclosure Accuracy
          </h2>
          <p>
            Transport uses HTTPS/TLS in transit and private storage access controls on the server path. CleanData Studio does not claim end-to-end zero-knowledge encryption for server-side jobs, because server-side Pandas and openpyxl workers must inspect uploaded bytes to perform requested cleaning operations.
          </p>
        </section>
      </div>
    </div>
  );
};

export const TermsPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-10 sm:px-6 sm:py-14">
      <div className="space-y-2">
        <p className="text-xs font-medium text-blue-800">Service Terms</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-slate-950">
          Terms of Service (Draft for Legal Review)
        </h1>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-relaxed text-amber-950">
        <strong>Legal Review Notice:</strong> Generic terms templates require qualified legal counsel before commercial launch.
      </div>

      <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-relaxed text-slate-700">
        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            1. Validation Scope
          </h2>
          <p>
            Email syntax checks and phone number formatting validate syntactic format only and never confirm mailbox deliverability or active carrier registration. Users are responsible for reviewing Before/After diffs and approving destructive row removals before exporting or overwriting production records.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            2. Credits &amp; Failed Jobs
          </h2>
          <p>
            Server processing consumes 1 credit per up to 1,000 input rows (ceiling). Credits are reserved when a job is queued, committed on successful completion, and fully refunded if a job fails due to system or parsing errors.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-display text-base font-semibold text-slate-950">
            3. Acceptable Use
          </h2>
          <p>
            You must only upload or process datasets you are authorized to handle under applicable data-protection laws. Automated abuse, credential sharing, or uploading intentionally malformed payloads designed to exhaust server resources is prohibited.
          </p>
        </section>
      </div>
    </div>
  );
};
