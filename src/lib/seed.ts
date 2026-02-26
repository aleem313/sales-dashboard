import { sql } from "@vercel/postgres";

export async function migrateSchema() {
  // Drop old e-commerce tables
  await sql`DROP TABLE IF EXISTS sales CASCADE`;
  await sql`DROP TABLE IF EXISTS customers CASCADE`;
  await sql`DROP TABLE IF EXISTS products CASCADE`;
  await sql`DROP TABLE IF EXISTS regions CASCADE`;
  await sql`DROP TABLE IF EXISTS categories CASCADE`;

  // Drop old Vollna tables if re-running
  await sql`DROP VIEW IF EXISTS profile_stats`;
  await sql`DROP VIEW IF EXISTS agent_stats`;
  await sql`DROP TABLE IF EXISTS stats_cache CASCADE`;
  await sql`DROP TABLE IF EXISTS sync_log CASCADE`;
  await sql`DROP TABLE IF EXISTS jobs CASCADE`;
  await sql`DROP TABLE IF EXISTS profiles CASCADE`;
  await sql`DROP TABLE IF EXISTS agents CASCADE`;

  // Create agents
  await sql`
    CREATE TABLE agents (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      clickup_user_id   TEXT UNIQUE NOT NULL,
      name              TEXT NOT NULL,
      email             TEXT,
      avatar_url        TEXT,
      active            BOOLEAN DEFAULT true,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Create profiles
  await sql`
    CREATE TABLE profiles (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      profile_id        TEXT UNIQUE NOT NULL,
      profile_name      TEXT NOT NULL,
      stack             TEXT,
      vollna_filter_tag TEXT UNIQUE,
      agent_id          UUID REFERENCES agents(id),
      clickup_list_id   TEXT,
      active            BOOLEAN DEFAULT true,
      created_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Create jobs
  await sql`
    CREATE TABLE jobs (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id            TEXT UNIQUE NOT NULL,
      job_title         TEXT NOT NULL,
      job_url           TEXT,
      job_description   TEXT,
      budget_type       TEXT,
      budget_min        DECIMAL(10,2),
      budget_max        DECIMAL(10,2),
      hourly_min        DECIMAL(10,2),
      hourly_max        DECIMAL(10,2),
      skills            TEXT[],
      client_country    TEXT,
      client_rating     DECIMAL(3,2),
      client_total_spent DECIMAL(12,2),
      client_hires      INTEGER,
      posted_at         TIMESTAMPTZ,
      received_at       TIMESTAMPTZ DEFAULT NOW(),
      profile_id        TEXT REFERENCES profiles(profile_id),
      agent_id          UUID REFERENCES agents(id),
      clickup_task_id   TEXT,
      clickup_task_url  TEXT,
      clickup_status    TEXT DEFAULT 'Proposal Ready',
      proposal_text     TEXT,
      gpt_model         TEXT,
      gpt_tokens_used   INTEGER,
      outcome           TEXT,
      won_value         DECIMAL(10,2),
      proposal_sent_at  TIMESTAMPTZ,
      outcome_at        TIMESTAMPTZ,
      created_at        TIMESTAMPTZ DEFAULT NOW(),
      updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  // Create sync_log
  await sql`
    CREATE TABLE sync_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          TEXT NOT NULL,
      records_synced  INTEGER DEFAULT 0,
      records_updated INTEGER DEFAULT 0,
      errors          TEXT[],
      started_at      TIMESTAMPTZ DEFAULT NOW(),
      completed_at    TIMESTAMPTZ,
      status          TEXT DEFAULT 'running'
    )
  `;

  // Create stats_cache
  await sql`
    CREATE TABLE stats_cache (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      cache_key       TEXT UNIQUE NOT NULL,
      data            JSONB NOT NULL,
      computed_at     TIMESTAMPTZ DEFAULT NOW(),
      expires_at      TIMESTAMPTZ
    )
  `;

  // Indexes
  await sql`CREATE INDEX idx_jobs_profile_id ON jobs(profile_id)`;
  await sql`CREATE INDEX idx_jobs_agent_id ON jobs(agent_id)`;
  await sql`CREATE INDEX idx_jobs_received_at ON jobs(received_at DESC)`;
  await sql`CREATE INDEX idx_jobs_clickup_status ON jobs(clickup_status)`;
  await sql`CREATE INDEX idx_jobs_outcome ON jobs(outcome)`;
  await sql`CREATE INDEX idx_jobs_job_id ON jobs(job_id)`;

  // Views
  await sql`
    CREATE VIEW agent_stats AS
    SELECT
      a.id,
      a.name,
      a.clickup_user_id,
      COUNT(j.id) AS total_jobs,
      COUNT(CASE WHEN j.proposal_sent_at IS NOT NULL THEN 1 END) AS proposals_sent,
      COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
      COUNT(CASE WHEN j.outcome = 'lost' THEN 1 END) AS lost,
      ROUND(
        COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue,
      AVG(
        CASE WHEN j.proposal_sent_at IS NOT NULL
        THEN EXTRACT(EPOCH FROM (j.proposal_sent_at - j.received_at)) / 3600
        END
      ) AS avg_response_hours
    FROM agents a
    LEFT JOIN jobs j ON j.agent_id = a.id
    GROUP BY a.id, a.name, a.clickup_user_id
  `;

  await sql`
    CREATE VIEW profile_stats AS
    SELECT
      p.id,
      p.profile_id,
      p.profile_name,
      p.stack,
      COUNT(j.id) AS total_jobs,
      COUNT(CASE WHEN j.outcome = 'won' THEN 1 END) AS won,
      ROUND(
        COUNT(CASE WHEN j.outcome = 'won' THEN 1 END)::DECIMAL /
        NULLIF(COUNT(CASE WHEN j.outcome IN ('won','lost') THEN 1 END), 0) * 100, 1
      ) AS win_rate_pct,
      AVG(CASE WHEN j.outcome = 'won' THEN j.won_value END) AS avg_won_value,
      COALESCE(SUM(CASE WHEN j.outcome = 'won' THEN j.won_value END), 0) AS total_revenue
    FROM profiles p
    LEFT JOIN jobs j ON j.profile_id = p.profile_id
    GROUP BY p.id, p.profile_id, p.profile_name, p.stack
  `;

  return { migrated: true };
}

export async function seedTestData() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Cannot seed test data in production");
  }

  // --- Agents ---
  const agents = [
    { clickup_user_id: "agent_001", name: "Sarah Ahmed", email: "sarah@example.com" },
    { clickup_user_id: "agent_002", name: "Mike Chen", email: "mike@example.com" },
    { clickup_user_id: "agent_003", name: "Priya Sharma", email: "priya@example.com" },
    { clickup_user_id: "agent_004", name: "James Wilson", email: "james@example.com" },
  ];

  for (const a of agents) {
    await sql`
      INSERT INTO agents (clickup_user_id, name, email)
      VALUES (${a.clickup_user_id}, ${a.name}, ${a.email})
      ON CONFLICT (clickup_user_id) DO NOTHING
    `;
  }

  // --- Profiles ---
  const profiles = [
    { profile_id: "profile_react", profile_name: "React & Next.js", stack: "React, Next.js, TypeScript", vollna_filter_tag: "react-nextjs", clickup_user_id: "agent_001" },
    { profile_id: "profile_python", profile_name: "Python & AI/ML", stack: "Python, FastAPI, TensorFlow", vollna_filter_tag: "python-ai", clickup_user_id: "agent_002" },
    { profile_id: "profile_fullstack", profile_name: "Full Stack", stack: "Node.js, React, PostgreSQL", vollna_filter_tag: "fullstack", clickup_user_id: "agent_001" },
    { profile_id: "profile_mobile", profile_name: "Mobile Development", stack: "React Native, Flutter", vollna_filter_tag: "mobile", clickup_user_id: "agent_003" },
    { profile_id: "profile_devops", profile_name: "DevOps & Cloud", stack: "AWS, Docker, Kubernetes", vollna_filter_tag: "devops", clickup_user_id: "agent_004" },
    { profile_id: "profile_wordpress", profile_name: "WordPress & PHP", stack: "WordPress, PHP, WooCommerce", vollna_filter_tag: "wordpress", clickup_user_id: "agent_003" },
  ];

  for (const p of profiles) {
    const agentResult = await sql`SELECT id FROM agents WHERE clickup_user_id = ${p.clickup_user_id}`;
    const agentId = agentResult.rows[0]?.id;
    await sql`
      INSERT INTO profiles (profile_id, profile_name, stack, vollna_filter_tag, agent_id)
      VALUES (${p.profile_id}, ${p.profile_name}, ${p.stack}, ${p.vollna_filter_tag}, ${agentId})
      ON CONFLICT (profile_id) DO NOTHING
    `;
  }

  // --- Jobs ---
  const now = Date.now();
  const DAY = 86400000;
  const skillSets = [
    ["React", "TypeScript", "Next.js"],
    ["Python", "Machine Learning", "TensorFlow"],
    ["Node.js", "Express", "MongoDB"],
    ["React Native", "iOS", "Android"],
    ["AWS", "Docker", "CI/CD"],
    ["WordPress", "PHP", "WooCommerce"],
    ["Vue.js", "Nuxt", "GraphQL"],
    ["Django", "PostgreSQL", "REST API"],
  ];
  const jobTitles = [
    "Build a SaaS Dashboard with React",
    "Python ML Pipeline for E-Commerce",
    "Full Stack Web App Development",
    "Mobile App for Food Delivery",
    "AWS Infrastructure Setup & CI/CD",
    "WordPress E-Commerce Store",
    "AI Chatbot Integration",
    "React Native Social Media App",
    "Data Analytics Dashboard",
    "Kubernetes Cluster Migration",
    "Next.js Marketing Website",
    "Django REST API Development",
    "Flutter Cross-Platform App",
    "Shopify Custom Theme Development",
    "Node.js Microservices Architecture",
  ];
  const countries = ["United States", "United Kingdom", "Canada", "Germany", "Australia", "India", "UAE", "Netherlands"];

  function seededRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 16807 + 0) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }
  const random = seededRandom(42);

  const agentRows = await sql`SELECT id FROM agents`;
  const profileIds = profiles.map((p) => p.profile_id);

  for (let i = 0; i < 150; i++) {
    const daysAgo = Math.floor(random() * 90);
    const receivedAt = new Date(now - daysAgo * DAY);
    const profileId = profileIds[Math.floor(random() * profileIds.length)];
    const agent = agentRows.rows[Math.floor(random() * agentRows.rows.length)];
    const title = jobTitles[Math.floor(random() * jobTitles.length)] + ` #${i + 1}`;
    const budgetType = random() > 0.4 ? "fixed" : "hourly";
    const budgetMin = Math.floor(random() * 500 + 100);
    const budgetMax = budgetMin + Math.floor(random() * 2000 + 200);
    const skills = skillSets[Math.floor(random() * skillSets.length)];
    const skillsLiteral = "{" + skills.join(",") + "}";
    const country = countries[Math.floor(random() * countries.length)];
    const clientRating = +(3.5 + random() * 1.5).toFixed(2);
    const clientSpent = Math.floor(random() * 50000 + 1000);

    let status: string;
    let outcome: string | null = null;
    let wonValue: number | null = null;
    let proposalSentAt: string | null = null;
    let outcomeAt: string | null = null;

    if (daysAgo > 30) {
      const roll = random();
      if (roll < 0.25) {
        status = "Won"; outcome = "won";
        wonValue = Math.floor(random() * 3000 + 500);
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 8) * 3600000).toISOString();
        outcomeAt = new Date(new Date(proposalSentAt).getTime() + Math.floor(random() * 7) * DAY).toISOString();
      } else if (roll < 0.6) {
        status = "Lost"; outcome = "lost";
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 8) * 3600000).toISOString();
        outcomeAt = new Date(new Date(proposalSentAt).getTime() + Math.floor(random() * 14) * DAY).toISOString();
      } else if (roll < 0.7) {
        status = "Proposal Ready"; outcome = "skipped";
      } else {
        status = "Sent"; outcome = null;
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 12) * 3600000).toISOString();
      }
    } else if (daysAgo > 7) {
      const roll = random();
      if (roll < 0.15) {
        status = "Won"; outcome = "won";
        wonValue = Math.floor(random() * 3000 + 500);
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 6) * 3600000).toISOString();
        outcomeAt = new Date(new Date(proposalSentAt).getTime() + Math.floor(random() * 5) * DAY).toISOString();
      } else if (roll < 0.4) {
        status = "Following Up"; outcome = null;
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 6) * 3600000).toISOString();
      } else if (roll < 0.7) {
        status = "Sent"; outcome = null;
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 8) * 3600000).toISOString();
      } else {
        status = "Proposal Ready"; outcome = null;
      }
    } else {
      const roll = random();
      if (roll < 0.5) {
        status = "Proposal Ready"; outcome = null;
      } else {
        status = "Sent"; outcome = null;
        proposalSentAt = new Date(receivedAt.getTime() + Math.floor(random() * 4) * 3600000).toISOString();
      }
    }

    const postedAt = new Date(receivedAt.getTime() - Math.floor(random() * 2) * DAY).toISOString();

    await sql`
      INSERT INTO jobs (
        job_id, job_title, job_url, budget_type, budget_min, budget_max,
        skills, client_country, client_rating, client_total_spent,
        posted_at, received_at, profile_id, agent_id,
        clickup_task_id, clickup_status, proposal_text,
        gpt_model, outcome, won_value, proposal_sent_at, outcome_at
      ) VALUES (
        ${"job_" + String(i + 1).padStart(4, "0")},
        ${title},
        ${"https://www.upwork.com/jobs/~" + String(1000000 + i)},
        ${budgetType},
        ${budgetMin},
        ${budgetMax},
        ${skillsLiteral},
        ${country},
        ${clientRating},
        ${clientSpent},
        ${postedAt},
        ${receivedAt.toISOString()},
        ${profileId},
        ${agent.id},
        ${"task_" + String(i + 1).padStart(4, "0")},
        ${status},
        ${outcome !== "skipped" ? "Generated proposal text for job #" + (i + 1) : null},
        ${outcome !== "skipped" ? "gpt-4o" : null},
        ${outcome},
        ${wonValue},
        ${proposalSentAt},
        ${outcomeAt}
      )
      ON CONFLICT (job_id) DO NOTHING
    `;
  }

  // --- Sync log entries ---
  for (let i = 0; i < 5; i++) {
    const daysAgo = i * 2;
    const startedAt = new Date(now - daysAgo * DAY);
    await sql`
      INSERT INTO sync_log (source, records_synced, records_updated, started_at, completed_at, status)
      VALUES (
        'clickup',
        ${Math.floor(random() * 20 + 5)},
        ${Math.floor(random() * 10)},
        ${startedAt.toISOString()},
        ${new Date(startedAt.getTime() + 15000).toISOString()},
        'success'
      )
    `;
  }

  return {
    agents: agents.length,
    profiles: profiles.length,
    jobs: 150,
    sync_log_entries: 5,
  };
}
