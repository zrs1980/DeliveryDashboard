-- ═══════════════════════════════════════════════════════════════
-- CEBA Wiki — Reset & Seed
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

TRUNCATE wiki_pages, wiki_categories RESTART IDENTITY CASCADE;

-- ── Categories ────────────────────────────────────────────────
INSERT INTO wiki_categories (name, slug, icon) VALUES
  ('Overview',   'overview',  '🏠'),
  ('Documents',  'documents', '📁'),
  ('HR & Admin', 'hr-admin',  '👥'),
  ('Operations', 'ops',       '⚙️');

-- ── HOME ──────────────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Welcome to the CEBA Wiki', 'home', $$
<h1>Welcome to the CEBA Wiki</h1>
<p>Your central hub for SOPs, policies, team info, and company resources. Use the sidebar to navigate or search above.</p>
<blockquote>📌 <strong>New:</strong> Q1 2026 holiday schedule has been updated. See Company Holidays for details.</blockquote>
<h2>Quick Links</h2>
<ul>
<li><strong>SOPs</strong> — Step-by-step procedures for delivery and operations</li>
<li><strong>Policies</strong> — Company policies all team members must know</li>
<li><strong>Company Holidays</strong> — 2026 paid holiday schedule</li>
<li><strong>Team Directory</strong> — Who's who at CEBA Solutions</li>
<li><strong>Onboarding</strong> — First-30-days guide for new team members</li>
<li><strong>Tools &amp; Access</strong> — Core systems and how to request access</li>
</ul>
<h2>Recent Updates</h2>
<ul>
<li><strong>Project Delivery SOP</strong> — Updated by Shai · Mar 12, 2026</li>
<li><strong>Time Tracking Policy</strong> — New policy effective Jan 2026 · Angie · Mar 8, 2026</li>
<li><strong>SOW Template v2</strong> — In Review · Updated by Zabe · Mar 5, 2026</li>
</ul>
$$, (SELECT id FROM wiki_categories WHERE slug = 'overview'), 'Zabe', TRUE);

-- ── ANNOUNCEMENTS ─────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Announcements', 'announcements', $$
<h1>Announcements</h1>
<h2>🌏 Team Blue Sky (Australia) — First Global Partner Signed</h2>
<p>Loop ERP has officially signed Team Blue Sky as our first global partner in Australia. This is a major milestone for our international expansion. More details to follow from Zabe.</p>
<p><strong>Date:</strong> Mar 10, 2026</p>
<hr>
<h2>📅 2026 Holiday Schedule Updated</h2>
<p>The company holiday calendar has been updated for 2026. Please review the Company Holidays section and plan your PTO accordingly. Q1 dates are now finalised.</p>
<p><strong>Date:</strong> Jan 5, 2026</p>
<hr>
<h2>🔧 NetSuite Time Entry — New Policy Effective Jan 2026</h2>
<p>All time must be logged in NetSuite by 5pm the same working day. This applies to both billable and internal time. See the Time Tracking Policy in Policies for full details.</p>
<p><strong>Date:</strong> Dec 20, 2025</p>
$$, (SELECT id FROM wiki_categories WHERE slug = 'overview'), 'Zabe', TRUE);

-- ── TEAM DIRECTORY ────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Team Directory', 'team-directory', $$
<h1>Team Directory</h1>
<p>The full CEBA team. Roles marked with † are shared with Loop ERP.</p>
<h2>Leadership</h2>
<ul>
<li><strong>Zabe</strong> — Founder &amp; Managing Director</li>
</ul>
<h2>Project Management</h2>
<ul>
<li><strong>Shai Aradais</strong> — Project Manager</li>
<li><strong>Alecia Gilmore</strong> — Project Manager</li>
<li><strong>Kathy Bacero</strong> — Project Manager</li>
</ul>
<h2>Consulting</h2>
<ul>
<li><strong>Jason Tutanes</strong> — Senior Consultant</li>
<li><strong>Sam Balido</strong> — Consultant</li>
<li><strong>Carlos Roman</strong> — Consultant</li>
</ul>
<h2>Development</h2>
<ul>
<li><strong>Piero Loza Palma †</strong> — Lead Developer</li>
<li><strong>Winny †</strong> — Developer</li>
<li><strong>Enrique †</strong> — Developer</li>
</ul>
<h2>Operations &amp; Admin</h2>
<ul>
<li><strong>Ryan †</strong> — Operations</li>
<li><strong>Angie †</strong> — Admin &amp; HR</li>
</ul>
<blockquote>† Shared role with Loop ERP. For HR or payroll questions contact Angie. For system access contact Ryan.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'overview'), 'Zabe', FALSE);

-- ── SOPs ──────────────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Standard Operating Procedures', 'sops', $$
<h1>Standard Operating Procedures</h1>
<p>Step-by-step procedures for how we do the work. All team members are expected to follow and contribute to these documents.</p>
<h2>Client Delivery</h2>
<ul>
<li><strong>🚢 Project Kickoff &amp; Discovery Process</strong> — Discovery calls, scoping, stakeholder alignment · Owner: Shai</li>
<li><strong>🔄 NetSuite Implementation Methodology</strong> — Phase gates, deliverables, sign-off checkpoints · Owner: Jason</li>
<li><strong>✅ UAT &amp; Go-Live Checklist</strong> — Testing protocol, approvals, cutover steps · Owner: Sam</li>
<li><strong>📈 Post Go-Live Hypercare Process</strong> — 30-day support window, escalation paths · Owner: Alecia <em>(Draft)</em></li>
</ul>
<h2>Internal Operations</h2>
<ul>
<li><strong>⏱️ Time Entry &amp; Billability Guidelines</strong> — Daily logging expectations, billable vs non-billable · Owner: Angie</li>
<li><strong>🐛 Bug Escalation &amp; Resolution SOP</strong> — Severity tiers, response times, dev handoff · Owner: Piero <em>(In Review)</em></li>
<li><strong>💬 Client Communication Standards</strong> — Email tone, response windows, escalation protocol · Owner: Alecia</li>
<li><strong>📦 Change Request Management Process</strong> — CR intake, pricing, approval workflow · Owner: Shai <em>(Draft)</em></li>
</ul>
<hr>
<blockquote>All SOPs are owned by a named team member. If you spot an error or have a suggested update, message the owner directly in Slack.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'documents'), 'Shai Aradais', TRUE);

-- ── POLICIES ─────────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Company Policies', 'policies', $$
<h1>Company Policies</h1>
<p>Policies that govern how we operate as a team. Please review and acknowledge each one during onboarding.</p>
<h2>HR Policies</h2>
<ul>
<li><strong>🕐 Time Tracking Policy</strong> — All billable and internal time must be logged in NetSuite daily. Effective Jan 2025.</li>
<li><strong>🏖️ PTO &amp; Leave Policy</strong> — Accrual rates, approval process, and blackout dates. Effective Jan 2025.</li>
<li><strong>🏠 Remote Work Policy</strong> — Availability expectations, equipment, and home office setup. Effective Jan 2025.</li>
</ul>
<h2>Business Policies</h2>
<ul>
<li><strong>🔐 Confidentiality &amp; NDA Policy</strong> — Client data handling, IP ownership, and disclosure rules.</li>
<li><strong>💰 Expense &amp; Reimbursement Policy</strong> — Allowable expenses, submission timeline, and approvals. <em>(In Review)</em></li>
<li><strong>🖥️ Acceptable Use Policy</strong> — Company systems, software, AI tools, and client data. <em>(Draft)</em></li>
</ul>
<hr>
<blockquote>All team members must acknowledge receipt of the HR Policies and Confidentiality policy within their first 5 days. Return signed copies to Angie.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'documents'), 'Angie', FALSE);

-- ── TEMPLATES ────────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Document Templates', 'templates', $$
<h1>Document Templates</h1>
<p>Approved templates to be used for client-facing and internal documents. Always use the latest version listed below.</p>
<h2>Client-Facing</h2>
<ul>
<li><strong>📝 Statement of Work (SOW)</strong> — Standard client SOW · v2.1 · Owner: Zabe</li>
<li><strong>📊 Project Status Report</strong> — Weekly client update template · v1.3 · Owner: Shai</li>
<li><strong>🧪 UAT Script Template</strong> — User acceptance testing script · v1.0 · Owner: Sam</li>
<li><strong>🔄 Change Request Form</strong> — CR intake &amp; pricing · v1.1 · Owner: Shai</li>
</ul>
<h2>Internal</h2>
<ul>
<li><strong>📋 Meeting Notes Template</strong> — For all internal and client calls · Owner: Alecia</li>
</ul>
<hr>
<blockquote>Templates are stored in Google Drive under <strong>CEBA Shared → Templates</strong>. If you need edit access contact Ryan.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'documents'), 'Zabe', FALSE);

-- ── COMPANY HOLIDAYS ─────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'2026 Company Holidays', 'company-holidays', $$
<h1>2026 Company Holidays</h1>
<p>CEBA observes the following paid holidays. All dates are for the US unless noted.</p>
<h2>Q1 · January – March</h2>
<ul>
<li><strong>New Year's Day</strong> — Thu, Jan 1 ✓ <em>(past)</em></li>
<li><strong>MLK Jr. Day</strong> — Mon, Jan 19 ✓ <em>(past)</em></li>
<li><strong>Presidents' Day</strong> — Mon, Feb 16 ✓ <em>(past)</em></li>
</ul>
<h2>Q2 · April – June</h2>
<ul>
<li><strong>Good Friday</strong> — Fri, Apr 3</li>
<li><strong>Memorial Day</strong> — Mon, May 25</li>
<li><strong>Juneteenth</strong> — Fri, Jun 19</li>
</ul>
<h2>Q3 · July – September</h2>
<ul>
<li><strong>Independence Day</strong> — Fri, Jul 3 (observed)</li>
<li><strong>Labor Day</strong> — Mon, Sep 7</li>
</ul>
<h2>Q4 · October – December</h2>
<ul>
<li><strong>Thanksgiving Day</strong> — Thu, Nov 26</li>
<li><strong>Day After Thanksgiving</strong> — Fri, Nov 27</li>
<li><strong>Christmas Eve</strong> — Thu, Dec 24</li>
<li><strong>Christmas Day</strong> — Fri, Dec 25</li>
<li><strong>New Year's Eve</strong> — Thu, Dec 31</li>
</ul>
<hr>
<blockquote>Holiday schedule is reviewed annually. If a holiday falls on a weekend, CEBA observes the nearest weekday. Questions? Contact Angie.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'hr-admin'), 'Angie', FALSE);

-- ── BENEFITS & PTO ───────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Benefits & PTO', 'benefits-pto', $$
<h1>Benefits &amp; PTO</h1>
<p>A summary of CEBA's benefits and time-off policies. Contact Angie for questions or to submit requests.</p>
<h2>Time Off</h2>
<ul>
<li><strong>🏖️ PTO — 15 days/year (accrued)</strong> — Must be approved by your PM or Zabe 5 business days in advance. Log in NetSuite as "PTO".</li>
<li><strong>🤒 Sick Leave — 5 days/year</strong> — Notify your PM same day before 9am. Log in NetSuite as "Sick".</li>
<li><strong>👨‍👩‍👧 Parental Leave</strong> — Contact Angie to discuss your situation confidentially.</li>
</ul>
<h2>Other Benefits</h2>
<ul>
<li><strong>💻 Equipment Stipend</strong> — $500 one-time for home office setup on hire.</li>
<li><strong>📚 Learning &amp; Development</strong> — $1,000/year for training, certifications, and courses. Pre-approval required from Zabe.</li>
</ul>
<hr>
<blockquote>All PTO and sick leave must be tracked in NetSuite. Requests not logged will not count toward your balance. See the PTO &amp; Leave Policy for full details.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'hr-admin'), 'Angie', FALSE);

-- ── ONBOARDING ───────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'New Team Member Onboarding', 'onboarding', $$
<h1>New Team Member Onboarding</h1>
<p>Everything you need in your first 30 days. Your PM will walk you through your role-specific checklist on Day 1.</p>
<h2>Week 1 Essentials</h2>
<ul>
<li><strong>🔑 System Access Setup</strong> — NetSuite, ClickUp, Google Workspace, Slack. Request access via Ryan.</li>
<li><strong>📋 Read: Core SOPs</strong> — Project Delivery, Time Entry, Client Communication. Required reading.</li>
<li><strong>📜 Sign: Policies &amp; NDA</strong> — Return signed copies to Angie within 5 business days.</li>
</ul>
<h2>30-Day Checklist</h2>
<ul>
<li><strong>🧭 Shadow a client project</strong> — Coordinate with your PM to join an active engagement as an observer.</li>
<li><strong>🗺️ Complete NetSuite orientation</strong> — Internal training session with Jason or Sam.</li>
<li><strong>⏱️ Log your first time entries</strong> — Practice logging billable and non-billable time in NetSuite daily.</li>
<li><strong>👋 Meet the team</strong> — Coffee chats with at least 3 team members outside your immediate project.</li>
</ul>
<h2>Key Contacts</h2>
<ul>
<li><strong>System access</strong> — Ryan</li>
<li><strong>HR &amp; payroll</strong> — Angie</li>
<li><strong>Project assignment</strong> — Your PM (Shai, Alecia, or Kathy)</li>
<li><strong>NetSuite training</strong> — Jason or Sam</li>
</ul>
$$, (SELECT id FROM wiki_categories WHERE slug = 'hr-admin'), 'Kathy Bacero', TRUE);

-- ── TOOLS & ACCESS ────────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Tools & System Access', 'tools-access', $$
<h1>Tools &amp; System Access</h1>
<p>Core tools used across CEBA. Request access through Ryan for any system you don't have.</p>
<h2>Core Systems — Required for All Staff</h2>
<ul>
<li><strong>🟠 NetSuite</strong> — ERP, time tracking, project management, billing. Primary system of record.</li>
<li><strong>🟣 ClickUp</strong> — Task management, sprint planning, and project boards.</li>
<li><strong>📧 Google Workspace</strong> — Email, calendar, Drive, Docs, and Meet.</li>
<li><strong>💬 Slack</strong> — Team communication and client project channels.</li>
</ul>
<h2>Sales &amp; Marketing</h2>
<ul>
<li><strong>🟡 HubSpot</strong> — CRM, deals pipeline, and email sequences. Sales team only.</li>
<li><strong>🔵 Clay</strong> — Lead enrichment and prospecting workflows. Sales team only.</li>
</ul>
<h2>Requesting Access</h2>
<p>Message <strong>Ryan</strong> in Slack with:</p>
<ol>
<li>The tool you need access to</li>
<li>Your role and reason for access</li>
<li>Your manager's name for approval</li>
</ol>
<blockquote>All access requests must be approved by your PM or Zabe before Ryan can provision them. Allow 1–2 business days.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'ops'), 'Ryan', FALSE);

-- ── CLIENT RESOURCES ─────────────────────────────────────────
INSERT INTO wiki_pages (title, slug, body, category_id, author, is_pinned) VALUES (
'Client Resources', 'client-resources', $$
<h1>Client Resources</h1>
<p>Guides and resources for working with CEBA clients. For client-specific info, refer to the relevant project folder in Google Drive.</p>
<h2>Reference Documents</h2>
<ul>
<li><strong>🏭 Sortera — First Go-Live Lessons Learned</strong> — Key takeaways from Loop ERP's first client go-live using the Loop ERP SuiteApp. Internal use only.</li>
<li><strong>📐 Implementation Framework Guide</strong> — Standard implementation types, scope definitions, and phase structures. Owner: Shai. <em>(In Review)</em></li>
<li><strong>💲 SOW &amp; Billing Structure Guide</strong> — Engagement types, billing cadences, and rate cards. Internal use only.</li>
</ul>
<h2>Implementation Types</h2>
<ul>
<li><strong>Full Implementation</strong> — End-to-end NetSuite ERP rollout across all modules.</li>
<li><strong>Bolt-On</strong> — Loop ERP customisation layered onto an existing NetSuite environment (e.g. Sortera).</li>
<li><strong>Partner</strong> — Delivered through a global partner (e.g. Australia / Team Blue Sky).</li>
<li><strong>Service</strong> — Scoped service engagement, optimisation, or MRP work.</li>
</ul>
<hr>
<blockquote>Client-specific materials (SOWs, status reports, meeting notes) are stored in <strong>Google Drive → Client Projects → [Client Name]</strong>. Do not store client data in this wiki.</blockquote>
$$, (SELECT id FROM wiki_categories WHERE slug = 'ops'), 'Shai Aradais', FALSE);
